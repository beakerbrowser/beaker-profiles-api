const test = require('ava')
const DatArchive = require('node-dat-archive')
const tempy = require('tempy')
const ProfilesAPI = require('../')
const fs = require('fs')

var db

var alice
var bob
var carla

test.before('archive creation', async t => {
  // create the archives
  ;[alice, bob, carla] = await Promise.all([
    DatArchive.create({title: 'Alice', localPath: tempy.directory()}),
    DatArchive.create({title: 'Bob', localPath: tempy.directory()}),
    DatArchive.create({title: 'Carla', localPath: tempy.directory()})
  ])

  // create the db
  db = await ProfilesAPI.open(tempy.directory(), alice, {DatArchive})

  // add to database
  await db.addArchives([alice, bob, carla])
})

test.after('close db', async t => {
  await db.close()
})

test('profile data', async t => {
  // write profiles
  await db.setProfile(alice, {
    name: 'Alice',
    bio: 'A cool hacker girl',
    avatar: 'alice.png',
    follows: [{name: 'Bob', url: bob.url}, {name: 'Carla', url: carla.url}]
  })
  t.deepEqual((await alice.getInfo()).title, 'User: Alice')
  await db.setProfile(bob, {
    name: 'Bob',
    avatar: 'bob.png',
    bio: 'A cool hacker guy'
  })

  const avatarBuffer = fs.readFileSync('avatar.jpg').buffer

  await db.setAvatar(bob, avatarBuffer, 'jpg')
  await db.follow(bob, alice, 'Alice')
  await db.setProfile(carla, {
    name: 'Carla'
  })
  await db.follow(carla, alice)

  // verify data
  t.truthy(await bob.stat('/avatar.jpg'))
  t.deepEqual(await db.getProfile(alice), {
    _origin: alice.url,
    _url: alice.url + '/profile.json',
    name: 'Alice',
    bio: 'A cool hacker girl',
    avatar: '/alice.png',
    followUrls: [bob.url, carla.url],
    follows: [{name: 'Bob', url: bob.url}, {name: 'Carla', url: carla.url}]
  })
  t.deepEqual(await db.getProfile(bob), {
    _origin: bob.url,
    _url: bob.url + '/profile.json',
    name: 'Bob',
    bio: 'A cool hacker guy',
    avatar: '/avatar.jpg',
    followUrls: [alice.url],
    follows: [{name: 'Alice', url: alice.url}]
  })
  t.deepEqual(await db.getProfile(carla), {
    _origin: carla.url,
    _url: carla.url + '/profile.json',
    name: 'Carla',
    bio: null,
    avatar: null,
    followUrls: [alice.url],
    follows: [{url: alice.url, name: null}]
  })
})

test('bookmarks', async t => {
  // bookmarks set/get
  await db.bookmark(alice, 'https://beakerbrowser.com', {
    title: 'Beaker Browser site'
  })
  t.deepEqual(await db.isBookmarked(alice, 'https://beakerbrowser.com'), true)
  t.deepEqual(bookmarkSubset(await db.getBookmark(alice, 'https://beakerbrowser.com')), {
    _origin: alice.url,
    _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    id: 'https!beakerbrowser.com',
    href: 'https://beakerbrowser.com',
    title: 'Beaker Browser site',
    pinned: false
  })
  await db.bookmark(alice, 'https://beakerbrowser.com', {
    title: 'Beaker Browser Homepage'
  })
  t.deepEqual(bookmarkSubset(await db.getBookmark(alice, 'https://beakerbrowser.com')), {
    _origin: alice.url,
    _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    id: 'https!beakerbrowser.com',
    href: 'https://beakerbrowser.com',
    title: 'Beaker Browser Homepage',
    pinned: false
  })

  // bookmark pinning
  await db.setBookmarkPinned('https://beakerbrowser.com', true)
  t.deepEqual(bookmarkSubset(await db.getBookmark(alice, 'https://beakerbrowser.com')), {
    _origin: alice.url,
    _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    id: 'https!beakerbrowser.com',
    href: 'https://beakerbrowser.com',
    title: 'Beaker Browser Homepage',
    pinned: true
  })
  await db.setBookmarkPinned('https://beakerbrowser.com', false)
  await db.setBookmarkPinned('https://beakerbrowser.com', false) // second time cause problems?
  t.deepEqual(bookmarkSubset(await db.getBookmark(alice, 'https://beakerbrowser.com')), {
    _origin: alice.url,
    _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    id: 'https!beakerbrowser.com',
    href: 'https://beakerbrowser.com',
    title: 'Beaker Browser Homepage',
    pinned: false
  })
  await db.setBookmarkPinned('https://beakerbrowser.com', true)

  // bookmark queries
  await db.bookmark(bob, 'https://beakerbrowser.com', {
    title: 'Beaker Browser site'
  })
  await db.bookmark(carla, 'https://beakerbrowser.com/docs', {
    title: 'Beaker Browser docs'
  })
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({fetchAuthor: true})), [
    {
      _origin: carla.url,
      _url: carla.url + '/bookmarks/https!beakerbrowser.com!docs.json',
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com!docs',
      href: 'https://beakerbrowser.com/docs',
      title: 'Beaker Browser docs',
      pinned: false
    },
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      pinned: true
    },
    {
      _origin: bob.url,
      _url: bob.url + '/bookmarks/https!beakerbrowser.com.json',
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser site',
      pinned: true
    }
  ])
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({author: alice})), [
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      pinned: true
    }
  ])
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({author: [alice, bob]})), [
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      pinned: true
    },
    {
      _origin: bob.url,
      _url: bob.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser site',
      pinned: true
    }
  ])
  t.deepEqual(bookmarkSubsets(await db.listPinnedBookmarks(alice)), [
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      pinned: true
    }
  ])

  // unbookmark
  await db.unbookmark(alice, 'https://beakerbrowser.com')
  t.deepEqual(await db.isBookmarked(alice, 'https://beakerbrowser.com'), false)
  t.falsy(await db.getBookmark(alice, 'https://beakerbrowser.com'))
})

test('votes', async t => {
  // vote
  await db.vote(alice, {subject: 'https://beakerbrowser.com', subjectType: 'webpage', vote: 1})
  await db.vote(bob, {subject: 'https://beakerbrowser.com', subjectType: 'webpage', vote: 2}) // should coerce to 1
  await db.vote(carla, {subject: 'https://beakerbrowser.com', subjectType: 'webpage', vote: 1})
  await db.vote(alice, {subject: 'dat://beakerbrowser.com', subjectType: 'webpage', vote: 1})
  await db.vote(bob, {subject: 'dat://beakerbrowser.com', subjectType: 'webpage', vote: 0})
  await db.vote(carla, {subject: 'dat://beakerbrowser.com', subjectType: 'webpage', vote: -1})
  await db.vote(alice, {subject: 'dat://bob.com/posts/1.json', subjectType: 'post', vote: -1})
  await db.vote(bob, {subject: 'dat://bob.com/posts/1.json', subjectType: 'post', vote: -1})
  await db.vote(carla, {subject: 'dat://bob.com/posts/1.json', subjectType: 'post', vote: -1})

  // listVotesFor

  // simple usage
  t.deepEqual(voteSubsets(await db.listVotesFor('https://beakerbrowser.com')), [
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false }
  ])
  // url is normalized
  t.deepEqual(voteSubsets(await db.listVotesFor('https://beakerbrowser.com/')), [
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false }
  ])
  // simple usage
  t.deepEqual(voteSubsets(await db.listVotesFor('dat://beakerbrowser.com')), [
    { id: 'dat!beakerbrowser.com',
      subject: 'dat://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'dat!beakerbrowser.com',
      subject: 'dat://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 0,
      author: false },
    { id: 'dat!beakerbrowser.com',
      subject: 'dat://beakerbrowser.com',
      subjectType: 'webpage',
      vote: -1,
      author: false }
  ])
  // simple usage
  t.deepEqual(voteSubsets(await db.listVotesFor('dat://bob.com/posts/1.json')), [
    { id: 'dat!bob.com!posts!1.json',
      subject: 'dat://bob.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false },
    { id: 'dat!bob.com!posts!1.json',
      subject: 'dat://bob.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false },
    { id: 'dat!bob.com!posts!1.json',
      subject: 'dat://bob.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false }
  ])

  // countVotesFor

  // simple usage
  t.deepEqual(await db.countVotesFor('https://beakerbrowser.com'), {
    up: 3,
    down: 0,
    value: 3,
    upVoters: [alice.url, bob.url, carla.url],
    currentUsersVote: 1
  })
  // url is normalized
  t.deepEqual(await db.countVotesFor('https://beakerbrowser.com/'), {
    up: 3,
    down: 0,
    value: 3,
    upVoters: [alice.url, bob.url, carla.url],
    currentUsersVote: 1
  })
  // simple usage
  t.deepEqual(await db.countVotesFor('dat://beakerbrowser.com'), {
    up: 1,
    down: 1,
    value: 0,
    upVoters: [alice.url],
    currentUsersVote: 1
  })
  // simple usage
  t.deepEqual(await db.countVotesFor('dat://bob.com/posts/1.json'), {
    up: 0,
    down: 3,
    value: -3,
    upVoters: [],
    currentUsersVote: -1
  })

  // listVotesBySubjectType

  // simple usage
  t.deepEqual(voteSubsets(await db.listVotesBySubjectType('webpage')), [
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'dat!beakerbrowser.com',
      subject: 'dat://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'dat!beakerbrowser.com',
      subject: 'dat://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 0,
      author: false },
    { id: 'dat!beakerbrowser.com',
      subject: 'dat://beakerbrowser.com',
      subjectType: 'webpage',
      vote: -1,
      author: false }
  ])
  // simple usage
  t.deepEqual(voteSubsets(await db.listVotesBySubjectType('post')), [
    { id: 'dat!bob.com!posts!1.json',
      subject: 'dat://bob.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false },
    { id: 'dat!bob.com!posts!1.json',
      subject: 'dat://bob.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false },
    { id: 'dat!bob.com!posts!1.json',
      subject: 'dat://bob.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false }
  ])
  // some params
  t.deepEqual(voteSubsets(await db.listVotesBySubjectType('webpage', {fetchAuthor: true, limit: 1})), [
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: true }
  ])

  // listVotesByAuthor

  // simple usage
  t.deepEqual(voteSubsets(await db.listVotesByAuthor(alice)), [
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'dat!beakerbrowser.com',
      subject: 'dat://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false },
    { id: 'dat!bob.com!posts!1.json',
      subject: 'dat://bob.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false }
  ])
  // some params
  t.deepEqual(voteSubsets(await db.listVotesByAuthor(alice, {limit: 1})), [
    { id: 'https!beakerbrowser.com',
      subject: 'https://beakerbrowser.com',
      subjectType: 'webpage',
      vote: 1,
      author: false }
  ])
})

function bookmarkSubsets (bs) {
  bs = bs.map(bookmarkSubset)
  bs.sort((a, b) => a.title.localeCompare(b.title))
  return bs
}

function bookmarkSubset (b) {
  return {
    _origin: b._origin,
    _url: b._url,
    author: !!b.author,
    id: b.id,
    href: b.href,
    title: b.title,
    pinned: b.pinned
  }
}

function voteSubsets (vs) {
  vs = vs.map(voteSubset)
  vs.sort((a, b) => b.vote - a.vote)
  return vs
}

function voteSubset (v) {
  return {
    id: v.id,
    subject: v.subject,
    subjectType: v.subjectType,
    vote: v.vote,
    author: !!v.author
  }
}
