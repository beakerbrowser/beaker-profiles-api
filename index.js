const WebDB = require('@beaker/webdb')
const through2 = require('through2')
const concat = require('concat-stream')
const newID = require('monotonic-timestamp-base36')
const coerce = require('./lib/coerce')

// exported api
// =

exports.open = async function (webdbNameOrPath, userArchive, opts) {
  // setup the database
  var db = new WebDB(webdbNameOrPath, opts)

  db.define('profiles', {
    filePattern: '/profile.json',
    index: ['*followUrls'],
    schema: {
      type: 'object',
      properties: {
        name: {type: 'string'},
        bio: {type: 'string'},
        avatar: {type: 'string'},
        follows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: {type: 'string'},
              name: {type: 'string'}
            },
            required: ['url']
          }
        }
      }
    },
    preprocess (record) {
      record.follows = record.follows || []
      record.followUrls = record.follows.map(f => f.url)
      return record
    },
    serialize (record) {
      return {
        name: record.name,
        bio: record.bio,
        avatar: record.avatar,
        follows: record.follows
      }
    }
  })

  db.define('bookmarks', {
    filePattern: '/bookmarks/*.json',
    index: [':origin+href', '*tags'],
    schema: {
      type: 'object',
      properties: {
        href: {type: 'string'},
        title: {type: 'string'},
        tags: {type: 'array', items: {type: 'string'}},
        notes: {type: 'string'},
        createdAt: {type: 'number'}
      },
      required: ['href']
    },
    preprocess (record) {
      record.tags = record.tags || []
      return record
    }
  })

  db.define('posts', {
    filePattern: '/posts/*.json',
    index: ['createdAt', ':origin+createdAt', 'threadRoot', 'threadParent'],
    schema: {
      type: 'object',
      properties: {
        text: {type: 'string'},
        threadRoot: {type: 'string'},
        threadParent: {type: 'string'},
        createdAt: {type: 'number'}
      },
      required: ['text', 'createdAt']
    }
  })

  db.define('archives', {
    filePattern: '/archives/*.json',
    index: ['createdAt', ':origin+createdAt', 'url'],
    schema: {
      type: 'object',
      properties: {
        url: {type: 'string'},
        title: {type: 'string'},
        description: {type: 'string'},
        type: {type: 'array', items: {type: 'string'}},
        createdAt: {type: 'number'}
      },
      required: ['url']
    },
    preprocess (record) {
      record.createdAt = record.createdAt || 0
      return record
    }
  })

  db.define('votes', {
    filePattern: '/votes/*.json',
    index: ['subject', 'subjectType+createdAt', ':origin+createdAt'],
    schema: {
      type: 'object',
      properties: {
        subject: {type: 'string'},
        subjectType: {type: 'string'},
        vote: {type: 'number'},
        createdAt: {type: 'number'}
      },
      required: ['subject', 'vote']
    }
  })

  await db.open()
  const internalLevel = db.level.sublevel('_internal')
  const pinsLevel = internalLevel.sublevel('pins')

  if (userArchive) {
    // index the main user
    await db.addSource(userArchive)
    await prepareArchive(userArchive)

    // index the followers
    db.profiles.get(userArchive).then(async profile => {
      if (profile && profile.followUrls) {
        db.addSource(profile.followUrls)
      }
    })
  }

  async function prepareArchive (archive) {
    async function mkdir (path) {
      try { await archive.mkdir(path) } catch (e) {}
    }
    await mkdir('bookmarks')
    await mkdir('posts')
    await mkdir('archives')
    await mkdir('votes')
  }

  return {
    db,
    prepareArchive,

    async close ({destroy} = {}) {
      if (db) {
        var name = db.name
        await db.close()
        if (destroy) {
          await WebDB.delete(name)
        }
        this.db = null
      }
    },

    addSource (a) { return db.addSource(a) },
    removeSource (a) { return db.removeSource(a) },
    listArchives () { return db.listArchives() },

    async pruneUnfollowedArchives (userArchive) {
      var profile = await db.profiles.get(userArchive)
      var archives = db.listSources()
      await Promise.all(archives.map(a => {
        if (profile.followUrls.indexOf(a.url) === -1) {
          return db.removeSource(a)
        }
      }))
    },

    // profiles api
    // =

    getProfile (archive) {
      var archiveUrl = coerce.archiveUrl(archive)
      return db.profiles.get(archiveUrl + '/profile.json')
    },

    async setProfile (archive, profile) {
      // write data
      var archiveUrl = coerce.archiveUrl(archive)
      profile = coerce.object(profile, {required: true})
      await db.profiles.upsert(archiveUrl + '/profile.json', profile)

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
      return db.profiles.upsert(archive.url + '/profile.json', {avatar: filename})
    },

    async follow (archive, target, name) {
      // update the follow record
      var archiveUrl = coerce.archiveUrl(archive)
      var targetUrl = coerce.archiveUrl(target)
      var changes = await db.profiles.where(':origin').equals(archiveUrl).update(record => {
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
      await db.addSource(target)
    },

    async unfollow (archive, target) {
      // update the follow record
      var archiveUrl = coerce.archiveUrl(archive)
      var targetUrl = coerce.archiveUrl(target)
      var changes = await db.profiles.where(':origin').equals(archiveUrl).update(record => {
        record.follows = record.follows || []
        record.follows = record.follows.filter(f => f.url !== targetUrl)
        return record
      })
      if (changes === 0) {
        throw new Error('Failed to unfollow: no profile record exists. Run setProfile() before unfollow().')
      }
      // unindex the target
      await db.removeSource(target)
    },

    getFollowersQuery (archive) {
      var archiveUrl = coerce.archiveUrl(archive)
      return db.profiles.where('followUrls').equals(archiveUrl)
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
      var profileA = await db.profiles.get(archiveAUrl + '/profile.json')
      return profileA.followUrls.indexOf(archiveBUrl) !== -1
    },

    async listFriends (archive) {
      var followers = await this.listFollowers(archive)
      await Promise.all(followers.map(async follower => {
        follower.isFriend = await this.isFollowing(archive, follower.getRecordOrigin())
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
      var archiveUrl = coerce.archiveUrl(archive)
      href = coerce.string(href)
      title = title && coerce.string(title)
      tags = tags && coerce.arrayOfStrings(tags)
      notes = notes && coerce.string(notes)
      if (!href) throw new Error('Must provide bookmark URL')
      const id = coerce.urlSlug(href)
      const createdAt = Date.now()
      return db.bookmarks.upsert(`${archiveUrl}/bookmarks/${id}.json`, {href, title, tags, notes, createdAt})
    },

    async unbookmark (archive, href) {
      var origin = coerce.archiveUrl(archive)
      await db.bookmarks.where(':origin+href').equals([origin, href]).delete()
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
            query = query.filter(record => author.includes(record.getRecordOrigin()))
          } else {
            author = coerce.archiveUrl(author)
            query = query.filter(record => record.getRecordOrigin() === author)
          }
        }
      } else if (author) {
        // primary filter by author
        if (Array.isArray(author)) {
          author = author.map(coerce.archiveUrl)
          query = query.where(':origin').anyOf(...author)
        } else {
          author = coerce.archiveUrl(author)
          query = query.where(':origin').equals(author)
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
          if (!profiles[b.getRecordOrigin()]) {
            profiles[b.getRecordOrigin()] = this.getProfile(b.getRecordOrigin())
          }
          b.author = await profiles[b.getRecordOrigin()]
        }))
      }

      await Promise.all(promises)
      return bookmarks
    },

    async getBookmark (archive, href) {
      const origin = coerce.archiveUrl(archive)
      var record = await db.bookmarks.where(':origin+href').equals([origin, href]).first()
      if (!record) return null
      record.pinned = await this.isBookmarkPinned(href)
      record.author = await this.getProfile(record.getRecordOrigin())
      return record
    },

    async isBookmarked (archive, href) {
      const origin = coerce.archiveUrl(archive)
      var record = await db.bookmarks.where(':origin+href').equals([origin, href]).first()
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
      const archiveUrl = coerce.archiveUrl(archive)
      text = coerce.string(text)
      threadParent = threadParent ? coerce.recordUrl(threadParent) : undefined
      threadRoot = threadRoot ? coerce.recordUrl(threadRoot) : threadParent
      if (!text) throw new Error('Must provide text')
      const createdAt = Date.now()
      return db.posts.put(`${archiveUrl}/posts/${newID()}.json`, {text, threadRoot, threadParent, createdAt})
    },

    getPostsQuery ({author, rootPostsOnly, after, before, offset, limit, reverse} = {}) {
      var query = db.posts
      if (author) {
        author = coerce.archiveUrl(author)
        after = after || 0
        before = before || Infinity
        query = query.where(':origin+createdAt').between([author, after], [author, before])
      } else if (after || before) {
        after = after || 0
        before = before || Infinity
        query = query.where('createdAt').between(after, before)
      } else {
        query = query.orderBy('createdAt')
      }
      if (rootPostsOnly) {
        query = query.filter(post => !post.threadParent)
      }
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
          if (!profiles[b.getRecordOrigin()]) {
            profiles[b.getRecordOrigin()] = this.getProfile(b.getRecordOrigin())
          }
          b.author = await profiles[b.getRecordOrigin()]
        }))
      }

      // tabulate votes
      if (opts.countVotes) {
        promises = promises.concat(posts.map(async b => {
          b.votes = await this.countVotesFor(b.getRecordURL())
        }))
      }

      // fetch replies
      if (opts.fetchReplies) {
        promises = promises.concat(posts.map(async b => {
          b.replies = await this.listPosts({fetchAuthor: true, countVotes: opts.countVotes}, this.getRepliesQuery(b.getRecordURL()))
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
      record.author = await this.getProfile(record.getRecordOrigin())
      record.votes = await this.countVotesFor(recordUrl)
      record.replies = await this.listPosts({fetchAuthor: true, countVotes: true}, this.getRepliesQuery(recordUrl))
      return record
    },

    // archives api
    // =

    async publishArchive (archive, archiveToPublish) {
      const archiveUrl = coerce.archiveUrl(archive)
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
      archiveToPublish.createdAt = archiveToPublish.createdAt || Date.now()
      return db.archives.put(`${archiveUrl}/archives/${newID()}.json`, archiveToPublish)
    },

    async unpublishArchive (archive, archiveToUnpublish) {
      const origin = coerce.archiveUrl(archive)
      const url = coerce.archiveUrl(archiveToUnpublish)
      await db.archives
        .where('url').equals(url)
        .filter(record => record.getRecordOrigin() === origin)
        .delete()
    },

    getPublishedArchivesQuery ({author, archive, after, before, offset, limit, reverse} = {}) {
      var query = db.archives
      if (author) {
        author = coerce.archiveUrl(author)
        after = after || 0
        before = before || Infinity
        query = query.where(':origin+createdAt').between([author, after], [author, before])
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
          if (!profiles[b.getRecordOrigin()]) {
            profiles[b.getRecordOrigin()] = this.getProfile(b.getRecordOrigin())
          }
          b.author = await profiles[b.getRecordOrigin()]
        }))
      }

      // tabulate votes
      if (opts.countVotes) {
        promises = promises.concat(archives.map(async b => {
          b.votes = await this.countVotesFor(b.getRecordURL())
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
      record.author = await this.getProfile(record.getRecordOrigin())
      record.votes = await this.countVotesFor(recordUrl)
      return record
    },

    // votes api
    // =

    vote (archive, {vote, subject, subjectType}) {
      const archiveUrl = coerce.archiveUrl(archive)
      vote = coerce.vote(vote)
      subjectType = coerce.string(subjectType)
      if (!subjectType) throw new Error('Subject type is required')
      if (!subject) throw new Error('Subject is required')
      if (subject.getRecordURL) subject = subject.getRecordURL()
      if (subject.url) subject = subject.url
      subject = coerce.url(subject)
      const createdAt = Date.now()
      return db.votes.put(`${archiveUrl}/votes/${coerce.urlSlug(subject)}.json`, {vote, subject, subjectType, createdAt})
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
        .where(':origin+createdAt')
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
          if (!profiles[b.getRecordOrigin()]) {
            profiles[b.getRecordOrigin()] = this.getProfile(b.getRecordOrigin())
          }
          b.author = await profiles[b.getRecordOrigin()]
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
          res.upVoters.push(record.getRecordOrigin())
          res.up++
        }
        if (record.vote === -1) {
          res.down++
        }
        if (userArchive && record.getRecordOrigin() === userArchive.url) {
          res.currentUsersVote = record.vote
        }
      })
      return res
    }
  }
}
