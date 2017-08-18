const InjestDB = require('injestdb')
const through2 = require('through2')
const concat = require('concat-stream')
const coerce = require('./lib/coerce')

// exported api
// =

exports.open = async function (injestNameOrPath, userArchive) {
  // setup the archive
  var db = new InjestDB(injestNameOrPath)
  db.schema({
    version: 1,
    profile: {
      singular: true,
      index: ['*followUrls'],
      validator: record => ({
        name: coerce.string(record.name),
        bio: coerce.string(record.bio),
        avatar: coerce.path(record.avatar),
        follows: coerce.arrayOfFollows(record.follows),
        followUrls: coerce.arrayOfFollows(record.follows).map(f => f.url)
      })
    },
    bookmarks: {
      primaryKey: 'id',
      index: ['_origin+subject'],
      validator: record => ({
        id: coerce.bookmarkId(record.subject),
        subject: coerce.string(record.subject, {required: true}),
        title: coerce.string(record.title),
        createdAt: coerce.number(record.createdAt) || Date.now()
      })
    },
    broadcasts: {
      primaryKey: 'createdAt',
      index: ['createdAt', '_origin+createdAt', 'threadRoot', 'threadParent'],
      validator: record => ({
        text: coerce.string(record.text),
        threadRoot: coerce.datUrl(record.threadRoot),
        threadParent: coerce.datUrl(record.threadParent),
        createdAt: coerce.number(record.createdAt, {required: true}),
        receivedAt: Date.now()
      })
    },
    votes: {
      primaryKey: 'subject',
      index: ['subject'],
      validator: record => ({
        subject: coerce.voteSubject(coerce.datUrl(record.subject), {required: true}),
        vote: coerce.vote(record.vote),
        createdAt: coerce.number(record.createdAt, {required: true})
      })
    }
  })
  await db.open()
  const internalLevel = db.level.sublevel('_internal')
  const pinsLevel = internalLevel.sublevel('pins')

  if (userArchive) {
    // index the main user
    await db.addArchive(userArchive, {prepare: true})

    // index the followers
    db.profile.get(userArchive).then(async profile => {
      profile.followUrls.forEach(url => db.addArchive(url))
    })
  }

  return {
    db,

    async close ({destroy} = {}) {
      if (db) {
        var name = db.name
        await db.close()
        if (destroy) {
          await InjestDB.delete(name)
        }
        this.db = null
      }
    },

    addArchive (a) { return db.addArchive(a, {prepare: true}) },
    addArchives (as) { return db.addArchives(as, {prepare: true}) },
    removeArchive (a) { return db.removeArchive(a) },
    listArchives () { return db.listArchives() },

    async pruneUnfollowedArchives (userArchive) {
      var profile = await db.profile.get(userArchive)
      var archives = db.listArchives()
      await Promise.all(archives.map(a => {
        if (profile.followUrls.indexOf(a.url) === -1) {
          return db.removeArchive(a)
        }
      }))
    },

    // profiles api
    // =

    getProfile (archive) {
      var archiveUrl = coerce.archiveUrl(archive)
      return db.profile.get(archiveUrl)
    },

    setProfile (archive, profile) {
      var archiveUrl = coerce.archiveUrl(archive)
      return db.profile.upsert(archiveUrl, profile)
    },

    async setAvatar (archive, imgData, extension) {
      archive = coerce.archive(archive)
      const filename = `avatar.${extension}`

      if (archive) {
        await archive.writeFile(filename, imgData)
        await archive.commit()
      }
      return db.profile.upsert(archive, {avatar: filename})
    },

    async follow (archive, target, name) {
      // update the follow record
      var archiveUrl = coerce.archiveUrl(archive)
      var targetUrl = coerce.archiveUrl(target)
      var changes = await db.profile.where('_origin').equals(archiveUrl).update(record => {
        record.follows = record.follows || []
        if (!record.follows.find(f => f.url === targetUrl)) {
          record.follows.push({url: targetUrl, name})
        }
        return record
      })
      if (changes === 0) {
        throw new Error('Failed to follow: no profile record exists. Run setProfile() before follow().')
      }
      // index the target
      await db.addArchive(target)
    },

    async unfollow (archive, target) {
      // update the follow record
      var archiveUrl = coerce.archiveUrl(archive)
      var targetUrl = coerce.archiveUrl(target)
      var changes = await db.profile.where('_origin').equals(archiveUrl).update(record => {
        record.follows = record.follows || []
        record.follows = record.follows.filter(f => f.url !== targetUrl)
        return record
      })
      if (changes === 0) {
        throw new Error('Failed to unfollow: no profile record exists. Run setProfile() before unfollow().')
      }
      // unindex the target
      await db.removeArchive(target)
    },

    getFollowersQuery (archive) {
      var archiveUrl = coerce.archiveUrl(archive)
      return db.profile.where('followUrls').equals(archiveUrl)
    },

    listFollowers (archive) {
      return this.getFollowersQuery(archive).toArray()
    },

    countFollowers (archive) {
      return this.getFollowersQuery(archive).count()
    },

    async isFollowing (archiveA, archiveB) {
      var archiveBUrl = coerce.archiveUrl(archiveB)
      var profileA = await db.profile.get(archiveA)
      return profileA.followUrls.indexOf(archiveBUrl) !== -1
    },

    async listFriends (archive) {
      var followers = await this.listFollowers(archive)
      await Promise.all(followers.map(async follower => {
        follower.isFriend = await this.isFollowing(archive, follower.url)
      }))
      return followers.filter(f => f.isFriend)
    },

    async countFriends (archive) {
      var friends = await this.listFriends(archive)
      return friends.length
    },

    async isFriendsWith (archiveA, archiveB) {
      var [a, b] = await Promise.all([
        this.isFollowing(archiveA, archiveB),
        this.isFollowing(archiveB, archiveA)
      ])
      return a && b
    },

    // bookmarks api
    // =

    async bookmark (archive, subjectUrl, {title} = {}) {
      subjectUrl = coerce.string(subjectUrl)
      title = coerce.string(title)
      if (!subjectUrl) throw new Error('Must provide subject URL')
      const createdAt = Date.now()
      return db.bookmarks.add(archive, {subject: subjectUrl, title, createdAt})
    },

    async unbookmark (archive, subjectUrl) {
      var _origin = coerce.archiveUrl(archive)
      await db.bookmarks.where('_origin+subject').equals([_origin, subjectUrl]).delete()
      await this.setBookmarkPinned(subjectUrl, false)
    },

    getBookmarksQuery ({author, pinned, offset, limit, reverse} = {}) {
      var query = db.bookmarks.query()
      if (author && Array.isArray(author)) {
        author = author.map(coerce.archiveUrl)
        query = query.where('_origin').anyOf(...author)
      } else if (author && !Array.isArray(author)) {
        author = coerce.archiveUrl(author)
        query = query.where('_origin').equals(author)
      }
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    async listBookmarks (opts = {}) {
      var promises = []
      var query = this.getBookmarksQuery(opts)
      var bookmarks = await query.toArray()

      // fetch pinned attr

      promises = promises.concat(bookmarks.map(async b => {
        b.pinned = await this.isBookmarkPinned(b.subject)
      }))

      // fetch author profile
      if (opts.fetchAuthor) {
        let profiles = {}
        promises = promises.concat(bookmarks.map(async b => {
          if (!profiles[b._origin]) {
            profiles[b._origin] = this.getProfile(b._origin)
          }
          b.author = await profiles[b._origin]
        }))
      }

      await Promise.all(promises)
      return bookmarks
    },

    async getBookmark (archive, subjectUrl) {
      const _origin = coerce.archiveUrl(archive)
      var record = await db.bookmarks.where('_origin+subject').equals([_origin, subjectUrl]).first()
      if (!record) return null
      record.pinned = await this.isBookmarkPinned(subjectUrl)
      record.author = await this.getProfile(record._origin)
      return record
    },

    async isBookmarked (archive, subjectUrl) {
      const _origin = coerce.archiveUrl(archive)
      var record = await db.bookmarks.where('_origin+subject').equals([_origin, subjectUrl]).first()
      return !!record
    },

    async isBookmarkPinned (subjectUrl) {
      try {
        return await pinsLevel.get(subjectUrl)
      } catch (e) {
        return false
      }
    },

    async setBookmarkPinned (subjectUrl, pinned) {
      if (pinned) {
        await pinsLevel.put(subjectUrl, true)
      } else {
        await pinsLevel.del(subjectUrl)
      }
    },

    async listPinnedBookmarks (archive) {
      archive = coerce.archiveUrl(archive)
      return new Promise(resolve => {
        pinsLevel.createKeyStream()
          .pipe(through2.obj(async (subjectUrl, enc, cb) => {
            try {
              cb(null, await this.getBookmark(archive, subjectUrl))
            } catch (e) {
              // ignore
              cb()
            }
          }))
          .pipe(concat(resolve))
      })
    },

    // broadcasts api
    // =

    broadcast (archive, {text, threadRoot, threadParent}) {
      text = coerce.string(text)
      threadParent = threadParent ? coerce.recordUrl(threadParent) : undefined
      threadRoot = threadRoot ? coerce.recordUrl(threadRoot) : threadParent
      if (!text) throw new Error('Must provide text')
      const createdAt = Date.now()
      return db.broadcasts.add(archive, {text, threadRoot, threadParent, createdAt})
    },

    getBroadcastsQuery ({author, after, before, offset, limit, reverse} = {}) {
      var query = db.broadcasts
      if (author) {
        author = coerce.archiveUrl(author)
        after = after || 0
        before = before || Infinity
        query = query.where('_origin+createdAt').between([author, after], [author, before])
      } else if (after || before) {
        after = after || 0
        before = before || Infinity
        query = query.where('createdAt').between(after, before)
      } else {
        query = query.orderBy('createdAt')
      }
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    getRepliesQuery (threadRootUrl, {offset, limit, reverse} = {}) {
      var query = db.broadcasts.where('threadRoot').equals(threadRootUrl)
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    async listBroadcasts (opts = {}, query) {
      var promises = []
      query = query || this.getBroadcastsQuery(opts)
      var broadcasts = await query.toArray()

      // fetch author profile
      if (opts.fetchAuthor) {
        let profiles = {}
        promises = promises.concat(broadcasts.map(async b => {
          if (!profiles[b._origin]) {
            profiles[b._origin] = this.getProfile(b._origin)
          }
          b.author = await profiles[b._origin]
        }))
      }

      // tabulate votes
      if (opts.countVotes) {
        promises = promises.concat(broadcasts.map(async b => {
          b.votes = await this.countVotes(b._url)
        }))
      }

      // fetch replies
      if (opts.fetchReplies) {
        promises = promises.concat(broadcasts.map(async b => {
          b.replies = await this.listBroadcasts({fetchAuthor: true}, this.getRepliesQuery(b._url))
        }))
      }

      await Promise.all(promises)
      return broadcasts
    },

    countBroadcasts (opts, query) {
      query = query || this.getBroadcastsQuery(opts)
      return query.count()
    },

    async getBroadcast (record) {
      const recordUrl = coerce.recordUrl(record)
      record = await db.broadcasts.get(recordUrl)
      record.author = await this.getProfile(record._origin)
      record.votes = await this.countVotes(recordUrl)
      record.replies = await this.listBroadcasts({fetchAuthor: true}, this.getRepliesQuery(recordUrl))
      return record
    },

    // votes api
    // =

    vote (archive, {vote, subject}) {
      vote = coerce.vote(vote)
      if (!subject) throw new Error('Subject is required')
      if (subject._url) subject = subject._url
      if (subject.url) subject = subject.url
      subject = coerce.datUrl(subject)
      const createdAt = Date.now()
      return db.votes.add(archive, {vote, subject, createdAt})
    },

    getVotesQuery (subject) {
      return db.votes.where('subject').equals(coerce.voteSubject(subject))
    },

    listVotes (subject) {
      return this.getVotesQuery(subject).toArray()
    },

    async countVotes (subject) {
      var res = {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0}
      await this.getVotesQuery(subject).each(record => {
        res.value += record.vote
        if (record.vote === 1) {
          res.upVoters.push(record._origin)
          res.up++
        }
        if (record.vote === -1) {
          res.down--
        }
        if (userArchive && record._origin === userArchive.url) {
          res.currentUsersVote = record.vote
        }
      })
      return res
    }
  }
}
