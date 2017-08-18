# Beaker Profiles API

An API for reading and writing profile archives as used by Beaker. A "Profile" is a Dat archive which

 1. represents a user (identity),
 2. broadcasts information (bookmarks, broadcasts, etc), and
 3. and follows other profiles (social relationships).

```js
var ProfilesAPI = require('beaker-profiles-api')

// create a db instance
var db = await ProfilesAPI.open(injestPathOrName[, mainUserArchive]) // mainUserArchive is a DatArchive instance

// profile data
// =

await db.getProfile(archive) // => {name:, bio:, avatar:}
await db.setProfile(archive, {name:, bio:, avatar:})

// management
// =

await db.close(destroy: Boolean) // close db instance, optionally delete its data

await db.addArchive(archive) // add archive to the db
await db.addArchives(archives) // add archives to the db
await db.removeArchive(archive) // remove archive from the db
db.listArchives() // list archives in the db
await db.pruneUnfollowedArchives(mainUserArchive) // remove archives from the db that arent followed by mainUserArchive

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

await db.setBookmark(archive, targetUrl, {
  title: string,
  pinned: boolean,
  favicon: string (base64 data url)
})
db.getBookmarksQuery({
  author?: url | DatArchive | Array<url | DatArchive>,
})
db.listBookmarks({
  // all opts from getBroadcastsQuery, plus:
  fetchAuthor: boolean
})
await db.getBookmark(archive, targetUrl)
  
// posting to the feed
// =

await db.broadcast(userArchive, {
  text: 'Hello, world!',
})

// posting a reply
await db.broadcast(userArchive, {
  text: 'Hello, world!',
  threadParent: parent._url, // url of message replying to
  threadRoot: top._url // url of topmost ancestor message - defaults to threadParent's value
})

// reading the feed
// =

// get InjestQuery for broadcasts
db.getBroadcastsQuery({
  author?: url | DatArchive,
  after: timestamp,
  before: timestamp,
  offset: number,
  limit: number,
  reverse: boolean
})

// get broadcast records
await db.listBroadcasts({
  // all opts from getBroadcastsQuery, plus:
  fetchAuthor: boolean,
  fetchReplies: boolean,
  countVotes: boolean
})

await db.countBroadcasts(/* same opts for getBroadcastsQuery */)
await db.getBroadcast(url)

// votes
// =

await db.vote (userArchive, {vote, subject})
// vote should be -1, 0, or 1
// subject should be a dat url

db.getVotesQuery(subject)
await db.listVotes(subject)

// this returns {up: number, down: number, value: number, upVoters: array of urls, currentUsersVote: number}
async db.countVotes(subject)
```
