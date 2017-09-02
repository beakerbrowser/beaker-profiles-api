# Beaker Profiles API

An API for reading and writing profile archives as used by Beaker. A "Profile" is a Dat archive which

 1. represents a user (identity),
 2. broadcasts information (bookmarks, posts, etc), and
 3. and follows other profiles (social relationships).

```js
var ProfilesAPI = require('beaker-profiles-api')

// create a db instance
var db = await ProfilesAPI.open(injestPathOrName[, mainUserArchive]) // mainUserArchive is a DatArchive instance

// management
// =

await db.close(destroy: Boolean) // close db instance, optionally delete its data

await db.addArchive(archive) // add archive to the db
await db.addArchives(archives) // add archives to the db
await db.removeArchive(archive) // remove archive from the db
db.listArchives() // list archives in the db
await db.pruneUnfollowedArchives(mainUserArchive) // remove archives from the db that arent followed by mainUserArchive

// profile data
// =

await db.getProfile(archive) // => {name:, bio:, avatar:}
await db.setProfile(archive, {name:, bio:})

// social relationships
// =

await db.follow(archive, targetUser, targetUserName?)
await db.unfollow(archive, targetUser)

db.getFollowersQuery(archive) // get InjestQuery for followers
await db.listFollowers(archive) // list users in db that follow the user
await db.countFollowers(archive) // count users in db that follow the user
await db.listFriends(archive) // list users in db that mutually follow the user
await db.countFriends(archive) // count users in db that mutually follow the user

await db.isFollowing(archiveA, archiveB) // => true
await db.isFriendsWith(archiveA, archiveB) // => true

// bookmarks
// =

await db.bookmark(archive, href, {
  title: string
})
await db.unbookmark(archive, href)
db.getBookmarksQuery({
  author: url | DatArchive | Array<url | DatArchive>,
  offset: number,
  limit: number,
  reverse: boolean
})
await db.listBookmarks({
  // all opts from getBookmarksQuery, plus:
  fetchAuthor: boolean
})
await db.getBookmark(archive, href)
await db.isBookmarked(archive, href)

// internal pinned bookmarks index
await db.setBookmarkPinned(href, pinned)
await db.listPinnedBookmarks(archive)
  
// posting to the feed
// =

await db.post(userArchive, {
  text: 'Hello, world!',
})

// posting a reply
await db.post(userArchive, {
  text: 'Hello, world!',
  threadParent: parent._url, // url of message replying to
  threadRoot: top._url // url of topmost ancestor message - defaults to threadParent's value
})

// reading the feed
// =

// get InjestQuery for posts
db.getPostsQuery({
  author?: url | DatArchive,
  after: timestamp,
  before: timestamp,
  offset: number,
  limit: number,
  reverse: boolean
})

// get post records
await db.listPosts({
  // all opts from getPostsQuery, plus:
  fetchAuthor: boolean,
  fetchReplies: boolean,
  countVotes: boolean
})

await db.countPosts(/* same opts for getPostsQuery */)
await db.getPost(url)

// votes
// =

await db.vote (userArchive, {
  vote: number (-1, 0, or 1),
  subject: string (a url),
  subjectType: string (ie 'webpage')
})

db.getVotesForQuery(subject)
db.getVotesBySubjectTypeQuery(type, {after, before, offset, limit, reverse})
db.getVotesByAuthorQuery(author, {after, before, offset, limit, reverse})

await db.listVotesFor(subject)
await db.listVotesBySubjectType(type, {
  // all opts from getVotesBySubjectTypeQuery, plus:
  fetchAuthor: boolean
})
await db.listVotesByAuthor(/* same opts for getVotesByAuthorQuery */)

// this returns {up: number, down: number, value: number, upVoters: array of urls, currentUsersVote: number}
async db.countVotesFor(subject)
```
