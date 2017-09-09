const InjestDB = require('injestdb')
const through2 = require('through2')
const concat = require('concat-stream')
const coerce = require('./lib/coerce')

// exported api
// =

exports.open = async function (injestNameOrPath, userArchive, opts) {
  // setup the archive
  var db = new InjestDB(injestNameOrPath, opts)
  db.schema({
    version: 2,
    profile: {
      singular: true,
      index: ['*followUrls'],
      validator: record => ({
        name: coerce.string(record.name),
        bio: coerce.string(record.bio),
        avatar: coerce.path(record.avatar),
        follows: coerce.arrayOfFollows(record.follows),
        followUrls: coerce.arrayOfFollows(record.follows).map(f => f.url)
      }),
      toFile: record => ({
        name: record.name,
        bio: record.bio,
        avatar: record.avatar,
        follows: record.follows
      })
    },
    bookmarks: {
      primaryKey: 'id',
      index: ['_origin+href', '*tags'],
      validator: record => ({
        id: coerce.urlSlug(record.href),
        href: coerce.string(record.href, {required: true}),
        title: coerce.string(record.title),
        tags: coerce.arrayOfStrings(record.tags),
        notes: coerce.string(record.notes),
        createdAt: coerce.number(record.createdAt) || Date.now()
      }),
      toFile: record => ({
        href: record.href,
        title: record.title,
        tags: record.tags,
        notes: record.notes,
        createdAt: record.createdAt
      })
    },
    posts: {
      primaryKey: 'createdAt',
      index: ['createdAt', '_origin+createdAt', 'threadRoot', 'threadParent'],
      validator: record => ({
        text: coerce.string(record.text),
        threadRoot: coerce.datUrl(record.threadRoot),
        threadParent: coerce.datUrl(record.threadParent),
        createdAt: coerce.number(record.createdAt, {required: true}),
        receivedAt: Date.now()
      }),
      toFile: record => ({
        text: record.text,
        threadRoot: record.threadRoot,
        threadParent: record.threadParent,
        createdAt: record.createdAt
      })
    },
    archives: {
      primaryKey: 'id',
      index: ['createdAt', '_origin+createdAt', 'url'],
      validator: record => ({
        id: coerce.urlSlug(record.url),
        url: coerce.required(coerce.archiveUrl(record.url), 'url'),
        title: coerce.string(record.title),
        description: coerce.string(record.description),
        type: coerce.arrayOfStrings(record.type),
        createdAt: coerce.number(record.createdAt) || Date.now(),
        receivedAt: Date.now()
      }),
      toFile: record => ({
        url: record.url,
        title: record.title,
        description: record.description,
        type: record.type,
        createdAt: record.createdAt
      })
    },
    votes: {
      primaryKey: 'id',
      index: ['subject', 'subjectType+createdAt', '_origin+createdAt'],
      validator: record => ({
        id: coerce.urlSlug(record.subject),
        subject: coerce.url(record.subject, {required: true}),
        subjectType: coerce.string(record.subjectType),
        vote: coerce.vote(record.vote),
        createdAt: coerce.number(record.createdAt, {required: true})
      }),
      toFile: record => ({
        subject: record.subject,
        subjectType: record.subjectType,
        vote: record.vote,
        createdAt: record.createdAt
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
      if (profile) {
        profile.followUrls.forEach(url => db.addArchive(url))
      }
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

    async setProfile (archive, profile) {
      // write data
      var archiveUrl = coerce.archiveUrl(archive)
      profile = coerce.object(profile, {required: true})
      await db.profile.upsert(archiveUrl, profile)

      // set name
      if ('name' in profile) {
        let title = coerce.string(profile.name) || 'anonymous'
        archive = db._archives[archiveUrl]
        await archive.configure({title: `User: ${title}`})
      }
    },

    async setAvatar (archive, imgData, extension) {
      archive = db._archives[coerce.archiveUrl(archive)]
      const filename = `avatar.${extension}`

      if (archive) {
        await archive.writeFile(filename, imgData)
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
      var archiveAUrl = coerce.archiveUrl(archiveA)
      var archiveBUrl = coerce.archiveUrl(archiveB)
      var profileA = await db.profile.get(archiveAUrl)
      return profileA.followUrls.indexOf(archiveBUrl) !== -1
    },

    async listFriends (archive) {
      var followers = await this.listFollowers(archive)
      await Promise.all(followers.map(async follower => {
        follower.isFriend = await this.isFollowing(archive, follower._origin)
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

    async bookmark (archive, href, {title, tags, notes} = {}) {
      href = coerce.string(href)
      title = title && coerce.string(title)
      tags = tags && coerce.arrayOfStrings(tags)
      notes = notes && coerce.string(notes)
      if (!href) throw new Error('Must provide bookmark URL')
      const id = coerce.urlSlug(href)
      const createdAt = Date.now()
      return db.bookmarks.upsert(archive, {id, href, title, tags, notes, createdAt})
    },

    async unbookmark (archive, href) {
      var _origin = coerce.archiveUrl(archive)
      await db.bookmarks.where('_origin+href').equals([_origin, href]).delete()
      await this.setBookmarkPinned(href, false)
    },

    getBookmarksQuery ({author, tag, offset, limit, reverse} = {}) {
      var query = db.bookmarks.query()
      if (tag) {
        // primary filter by tag
        tag = coerce.arrayOfStrings(tag)
        query.where('tags').equals(tag[0])
        if (tag.length > 1) {
          // anyOf() wont work because that gets all matches, and we want records with all of the given tags
          tag.shift() // drop the first one (already filtering)
          query = query.filter(record => {
            return tag.reduce((agg, t) => agg & record.tags.includes(t), true)
          })
        }
        if (author) {
          // secondary filter on author
          if (Array.isArray(author)) {
            author = author.map(coerce.archiveUrl)
            query = query.filter(record => author.includes(record._origin))
          } else {
            author = coerce.archiveUrl(author)
            query = query.filter(record => record._origin === author)
          }
        }
      } else if (author) {
        // primary filter by author
        if (Array.isArray(author)) {
          author = author.map(coerce.archiveUrl)
          query = query.where('_origin').anyOf(...author)
        } else {
          author = coerce.archiveUrl(author)
          query = query.where('_origin').equals(author)
        }
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
        b.pinned = await this.isBookmarkPinned(b.href)
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

    async getBookmark (archive, href) {
      const _origin = coerce.archiveUrl(archive)
      var record = await db.bookmarks.where('_origin+href').equals([_origin, href]).first()
      if (!record) return null
      record.pinned = await this.isBookmarkPinned(href)
      record.author = await this.getProfile(record._origin)
      return record
    },

    async isBookmarked (archive, href) {
      const _origin = coerce.archiveUrl(archive)
      var record = await db.bookmarks.where('_origin+href').equals([_origin, href]).first()
      return !!record
    },

    async isBookmarkPinned (href) {
      try {
        return await pinsLevel.get(href)
      } catch (e) {
        return false
      }
    },

    async setBookmarkPinned (href, pinned) {
      if (pinned) {
        await pinsLevel.put(href, true)
      } else {
        await pinsLevel.del(href)
      }
    },

    async listPinnedBookmarks (archive) {
      archive = coerce.archiveUrl(archive)
      return new Promise(resolve => {
        pinsLevel.createKeyStream()
          .pipe(through2.obj(async (href, enc, cb) => {
            try {
              cb(null, await this.getBookmark(archive, href))
            } catch (e) {
              // ignore
              cb()
            }
          }))
          .pipe(concat(resolve))
      })
    },

    async listBookmarkTags () {
      return db.bookmarks.orderBy('tags').uniqueKeys()
    },

    async countBookmarkTags () {
      var tags = await db.bookmarks.orderBy('tags').keys()
      var tagCounts = {}
      tags.forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1
      })
      return tagCounts
    },

    // posts api
    // =

    post (archive, {text, threadRoot, threadParent}) {
      text = coerce.string(text)
      threadParent = threadParent ? coerce.recordUrl(threadParent) : undefined
      threadRoot = threadRoot ? coerce.recordUrl(threadRoot) : threadParent
      if (!text) throw new Error('Must provide text')
      const createdAt = Date.now()
      return db.posts.add(archive, {text, threadRoot, threadParent, createdAt})
    },

    getPostsQuery ({author, after, before, offset, limit, reverse} = {}) {
      var query = db.posts
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
      query = query.filter(post => !post.threadParent) // no replies
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    getRepliesQuery (threadRootUrl, {offset, limit, reverse} = {}) {
      var query = db.posts.where('threadRoot').equals(threadRootUrl)
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    async listPosts (opts = {}, query) {
      var promises = []
      query = query || this.getPostsQuery(opts)
      var posts = await query.toArray()

      // fetch author profile
      if (opts.fetchAuthor) {
        let profiles = {}
        promises = promises.concat(posts.map(async b => {
          if (!profiles[b._origin]) {
            profiles[b._origin] = this.getProfile(b._origin)
          }
          b.author = await profiles[b._origin]
        }))
      }

      // tabulate votes
      if (opts.countVotes) {
        promises = promises.concat(posts.map(async b => {
          b.votes = await this.countVotesFor(b._url)
        }))
      }

      // fetch replies
      if (opts.fetchReplies) {
        promises = promises.concat(posts.map(async b => {
          b.replies = await this.listPosts({fetchAuthor: true, countVotes: opts.countVotes}, this.getRepliesQuery(b._url))
        }))
      }

      await Promise.all(promises)
      return posts
    },

    countPosts (opts, query) {
      query = query || this.getPostsQuery(opts)
      return query.count()
    },

    async getPost (record) {
      const recordUrl = coerce.recordUrl(record)
      record = await db.posts.get(recordUrl)
      if (!record) return null
      record.author = await this.getProfile(record._origin)
      record.votes = await this.countVotesFor(recordUrl)
      record.replies = await this.listPosts({fetchAuthor: true, countVotes: true}, this.getRepliesQuery(recordUrl))
      return record
    },

    // archives api
    // =

    async publishArchive (archive, archiveToPublish) {
      if (typeof archiveToPublish.getInfo === 'function') {
        // fetch info
        let info = await archiveToPublish.getInfo()
        archiveToPublish = {
          url: archiveToPublish.url,
          title: info.title,
          description: info.description,
          type: info.type
        }
      }
      archiveToPublish.url = coerce.archiveUrl(archiveToPublish.url)
      return db.archives.add(archive, archiveToPublish)
    },

    async unpublishArchive (archive, archiveToUnpublish) {
      const _origin = coerce.archiveUrl(archive)
      const url = coerce.archiveUrl(archiveToUnpublish)
      await db.archives
        .where('url').equals(url)
        .filter(record => record._origin === _origin)
        .delete()
    },

    getPublishedArchivesQuery ({author, archive, after, before, offset, limit, reverse} = {}) {
      var query = db.archives
      if (author) {
        author = coerce.archiveUrl(author)
        after = after || 0
        before = before || Infinity
        query = query.where('_origin+createdAt').between([author, after], [author, before])
      } else if (archive) {
        archive = coerce.archiveUrl(archive)
        query = query.where('url').equals(archive)
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

    async listPublishedArchives (opts = {}) {
      var promises = []
      var archives = await this.getPublishedArchivesQuery(opts).toArray()

      // fetch author profile
      if (opts.fetchAuthor) {
        let profiles = {}
        promises = promises.concat(archives.map(async b => {
          if (!profiles[b._origin]) {
            profiles[b._origin] = this.getProfile(b._origin)
          }
          b.author = await profiles[b._origin]
        }))
      }

      // tabulate votes
      if (opts.countVotes) {
        promises = promises.concat(archives.map(async b => {
          b.votes = await this.countVotesFor(b._url)
        }))
      }

      await Promise.all(promises)
      return archives
    },

    countPublishedArchives (opts) {
      return this.getPublishedArchivesQuery(opts).count()
    },

    async getPublishedArchive (record) {
      const recordUrl = coerce.recordUrl(record)
      record = await db.archives.get(recordUrl)
      if (!record) return null
      record.author = await this.getProfile(record._origin)
      record.votes = await this.countVotesFor(recordUrl)
      return record
    },

    // votes api
    // =

    vote (archive, {vote, subject, subjectType}) {
      vote = coerce.vote(vote)
      subjectType = coerce.string(subjectType)
      if (!subjectType) throw new Error('Subject type is required')
      if (!subject) throw new Error('Subject is required')
      if (subject._url) subject = subject._url
      if (subject.url) subject = subject.url
      subject = coerce.url(subject)
      const createdAt = Date.now()
      return db.votes.add(archive, {vote, subject, subjectType, createdAt})
    },

    getVotesForQuery (subject) {
      return db.votes.where('subject').equals(coerce.url(subject))
    },

    getVotesBySubjectTypeQuery (type, {after, before, offset, limit, reverse} = {}) {
      after = after || 0
      before = before || Infinity
      var query = db.votes
        .where('subjectType+createdAt')
        .between([type, after], [type, before])
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    getVotesByAuthorQuery (author, {after, before, offset, limit, reverse} = {}) {
      after = after || 0
      before = before || Infinity
      author = coerce.archiveUrl(author)
      var query = db.votes
        .where('_origin+createdAt')
        .between([author, after], [author, before])
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    listVotesFor (subject) {
      return this.getVotesForQuery(subject).toArray()
    },

    async listVotesBySubjectType (subject, opts = {}) {
      var promises = []
      var votes = await this.getVotesBySubjectTypeQuery(subject, opts).toArray()

      // fetch author profile
      if (opts.fetchAuthor) {
        let profiles = {}
        promises = promises.concat(votes.map(async b => {
          if (!profiles[b._origin]) {
            profiles[b._origin] = this.getProfile(b._origin)
          }
          b.author = await profiles[b._origin]
        }))
      }

      await Promise.all(promises)
      return votes
    },

    listVotesByAuthor (author, opts) {
      return this.getVotesByAuthorQuery(author, opts).toArray()
    },

    async countVotesFor (subject) {
      var res = {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0}
      await this.getVotesForQuery(subject).each(record => {
        res.value += record.vote
        if (record.vote === 1) {
          res.upVoters.push(record._origin)
          res.up++
        }
        if (record.vote === -1) {
          res.down++
        }
        if (userArchive && record._origin === userArchive.url) {
          res.currentUsersVote = record.vote
        }
      })
      return res
    }
  }
}
