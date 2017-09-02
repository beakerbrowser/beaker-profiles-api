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
    title: 'Beaker Browser site',
    notes: 'Foo'
  })
  t.deepEqual(await db.isBookmarked(alice, 'https://beakerbrowser.com'), true)
  t.deepEqual(bookmarkSubset(await db.getBookmark(alice, 'https://beakerbrowser.com')), {
    _origin: alice.url,
    _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    id: 'https!beakerbrowser.com',
    href: 'https://beakerbrowser.com',
    title: 'Beaker Browser site',
    tags: [],
    notes: 'Foo',
    pinned: false
  })

  // partial update title
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
    tags: [],
    notes: 'Foo',
    pinned: false
  })

  // partial update notes
  await db.bookmark(alice, 'https://beakerbrowser.com', {
    notes: 'Bar'
  })
  t.deepEqual(bookmarkSubset(await db.getBookmark(alice, 'https://beakerbrowser.com')), {
    _origin: alice.url,
    _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    id: 'https!beakerbrowser.com',
    href: 'https://beakerbrowser.com',
    title: 'Beaker Browser Homepage',
    tags: [],
    notes: 'Bar',
    pinned: false
  })

  // partial update tag (non array)
  await db.bookmark(alice, 'https://beakerbrowser.com', {
    tags: 'tag1'
  })
  t.deepEqual(bookmarkSubset(await db.getBookmark(alice, 'https://beakerbrowser.com')), {
    _origin: alice.url,
    _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    id: 'https!beakerbrowser.com',
    href: 'https://beakerbrowser.com',
    title: 'Beaker Browser Homepage',
    tags: ['tag1'],
    notes: 'Bar',
    pinned: false
  })

  // partial update tag (array)
  await db.bookmark(alice, 'https://beakerbrowser.com', {
    tags: ['tag1', 'tag2']
  })
  t.deepEqual(bookmarkSubset(await db.getBookmark(alice, 'https://beakerbrowser.com')), {
    _origin: alice.url,
    _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    id: 'https!beakerbrowser.com',
    href: 'https://beakerbrowser.com',
    title: 'Beaker Browser Homepage',
    tags: ['tag1', 'tag2'],
    notes: 'Bar',
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
    tags: ['tag1', 'tag2'],
    notes: 'Bar',
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
    tags: ['tag1', 'tag2'],
    notes: 'Bar',
    pinned: false
  })
  await db.setBookmarkPinned('https://beakerbrowser.com', true)

  // bookmark queries
  await db.bookmark(bob, 'https://beakerbrowser.com', {
    title: 'Beaker Browser site',
    tags: 'tag1'
  })
  await db.bookmark(carla, 'https://beakerbrowser.com/docs', {
    title: 'Beaker Browser docs'
  })

  // list all
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({fetchAuthor: true})), [
    {
      _origin: carla.url,
      _url: carla.url + '/bookmarks/https!beakerbrowser.com!docs.json',
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com!docs',
      href: 'https://beakerbrowser.com/docs',
      title: 'Beaker Browser docs',
      tags: [],
      notes: null,
      pinned: false
    },
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'Bar',
      pinned: true
    },
    {
      _origin: bob.url,
      _url: bob.url + '/bookmarks/https!beakerbrowser.com.json',
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser site',
      tags: ['tag1'],
      notes: null,
      pinned: true
    }
  ])

  // list by 1 tag
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({tag: 'tag1'})), [
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'Bar',
      pinned: true
    },
    {
      _origin: bob.url,
      _url: bob.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser site',
      tags: ['tag1'],
      notes: null,
      pinned: true
    }
  ])

  // list by 2 tags
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({tag: ['tag1', 'tag2']})), [
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'Bar',
      pinned: true
    }
  ])

  // list by 1 author
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({author: alice})), [
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'Bar',
      pinned: true
    }
  ])

  // list by 2 authors
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({author: [alice, bob]})), [
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'Bar',
      pinned: true
    },
    {
      _origin: bob.url,
      _url: bob.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser site',
      tags: ['tag1'],
      notes: null,
      pinned: true
    }
  ])

  // list by 1 tag & 1 author
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({tag: 'tag1', author: bob})), [
    {
      _origin: bob.url,
      _url: bob.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser site',
      tags: ['tag1'],
      notes: null,
      pinned: true
    }
  ])

  // list by 1 tag & 2 authors
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({tag: 'tag1', author: [alice, bob]})), [
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'Bar',
      pinned: true
    },
    {
      _origin: bob.url,
      _url: bob.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser site',
      tags: ['tag1'],
      notes: null,
      pinned: true
    }
  ])

  // list by 2 tags & 2 authors
  t.deepEqual(bookmarkSubsets(await db.listBookmarks({tag: ['tag1', 'tag2'], author: [alice, bob]})), [
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'Bar',
      pinned: true
    }
  ])

  // list pinned bookmarks
  t.deepEqual(bookmarkSubsets(await db.listPinnedBookmarks(alice)), [
    {
      _origin: alice.url,
      _url: alice.url + '/bookmarks/https!beakerbrowser.com.json',
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      id: 'https!beakerbrowser.com',
      href: 'https://beakerbrowser.com',
      title: 'Beaker Browser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'Bar',
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

test('posts', async t => {
  // make some posts
  var post1Url = await db.post(alice, {text: 'First'})
  await db.post(bob, {text: 'Second'})
  await db.post(carla, {text: 'Third'})
  var reply1Url = await db.post(bob, {
    text: 'First reply',
    threadParent: post1Url,
    threadRoot: post1Url
  })
  await db.post(carla, {
    text: 'Second reply',
    threadParent: reply1Url,
    threadRoot: post1Url
  })
  await db.post(alice, {text: 'Fourth'})

  // add some votes
  await db.vote(bob, {vote: 1, subject: post1Url, subjectType: 'post'})
  await db.vote(carla, {vote: 1, subject: post1Url, subjectType: 'post'})

  // get a post
  t.deepEqual(postSubset(await db.getPost(post1Url)), {
    author: true,
    text: 'First',
    threadParent: null,
    threadRoot: null,
    votes: {up: 2, down: 0, value: 2, upVoters: [bob.url, carla.url], currentUsersVote: 0},
    replies: [
      {
        author: true,
        text: 'First reply',
        threadParent: post1Url,
        threadRoot: post1Url,
        votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
        replies: undefined
      },
      {
        author: true,
        text: 'Second reply',
        threadParent: reply1Url,
        threadRoot: post1Url,
        votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
        replies: undefined
      }
    ]
  })

  // list posts (no params)
  t.deepEqual(postSubsets(await db.listPosts()), [
    {
      author: false,
      text: 'First',
      threadParent: null,
      threadRoot: null,
      votes: undefined,
      replies: undefined
    },
    {
      author: false,
      text: 'Second',
      threadParent: null,
      threadRoot: null,
      votes: undefined,
      replies: undefined
    },
    {
      author: false,
      text: 'Third',
      threadParent: null,
      threadRoot: null,
      votes: undefined,
      replies: undefined
    },
    {
      author: false,
      text: 'Fourth',
      threadParent: null,
      threadRoot: null,
      votes: undefined,
      replies: undefined
    }
  ])

  // list posts (authors, votes, and replies)
  t.deepEqual(postSubsets(await db.listPosts({fetchAuthor: true, countVotes: true, fetchReplies: true})), [
    {
      author: true,
      text: 'First',
      threadParent: null,
      threadRoot: null,
      votes: {up: 2, down: 0, value: 2, upVoters: [bob.url, carla.url], currentUsersVote: 0},
      replies: [
        {
          author: true,
          text: 'First reply',
          threadParent: post1Url,
          threadRoot: post1Url,
          votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
          replies: undefined
        },
        {
          author: true,
          text: 'Second reply',
          threadParent: reply1Url,
          threadRoot: post1Url,
          votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
          replies: undefined
        }
      ]
    },
    {
      author: true,
      text: 'Second',
      threadParent: null,
      threadRoot: null,
      votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
      replies: []
    },
    {
      author: true,
      text: 'Third',
      threadParent: null,
      threadRoot: null,
      votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
      replies: []
    },
    {
      author: true,
      text: 'Fourth',
      threadParent: null,
      threadRoot: null,
      votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
      replies: []
    }
  ])

  // list posts (limit, offset, reverse)
  t.deepEqual(postSubsets(await db.listPosts({limit: 1, offset: 1, fetchAuthor: true, countVotes: true, fetchReplies: true})), [
    {
      author: true,
      text: 'Second',
      threadParent: null,
      threadRoot: null,
      votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
      replies: []
    }
  ])
  t.deepEqual(postSubsets(await db.listPosts({reverse: true, limit: 1, offset: 1, fetchAuthor: true, countVotes: true, fetchReplies: true})), [
    {
      author: true,
      text: 'Third',
      threadParent: null,
      threadRoot: null,
      votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
      replies: []
    }
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
    tags: b.tags,
    notes: b.notes,
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

function postSubsets (ps) {
  ps = ps.map(postSubset)
  return ps
}

function postSubset (p) {
  return {
    author: !!p.author,
    text: p.text,
    threadParent: p.threadParent,
    threadRoot: p.threadRoot,
    votes: p.votes,
    replies: p.replies ? postSubsets(p.replies) : undefined
  }
}
