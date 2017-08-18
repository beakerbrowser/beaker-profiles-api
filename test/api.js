require('injestdb/node')
const test = require('ava')
const DatArchive = require('node-dat-archive')
const tempy = require('tempy')
const NexusAPI = require('../')
const fs = require('fs')

var alice
var bob
var carla

test('construct some archives with a guest session', async t => {
  var session = await NexusAPI.open(tempy.directory())

  // create the archives
  ;[alice, bob, carla] = await Promise.all([
    DatArchive.create({title: 'Alice', localPath: tempy.directory()}),
    DatArchive.create({title: 'Bob', localPath: tempy.directory()}),
    DatArchive.create({title: 'Carla', localPath: tempy.directory()})
  ])

  // add to nexus
  await session.addArchives([alice, bob, carla])

  // write profiles
  await session.setProfile(alice, {
    name: 'Alice',
    bio: 'A cool hacker girl',
    avatar: 'alice.png',
    follows: [{name: 'Bob', url: bob.url}, {name: 'Carla', url: carla.url}]
  })
  await session.setProfile(bob, {
    name: 'Bob',
    avatar: 'bob.png',
    bio: 'A cool hacker guy'
  })

  const fd = fs.readFileSync('avatar.jpg').buffer

  await session.setAvatar(bob, fd, 'jpg')
  await session.follow(bob, alice, 'Alice')
  await session.setProfile(carla, {
    name: 'Carla'
  })
  await session.follow(carla, alice)

  // verify data
  t.truthy(await bob.stat('/avatar.jpg'))
  t.deepEqual(await session.getProfile(alice), {
    _origin: alice.url,
    _url: alice.url + '/profile.json',
    name: 'Alice',
    bio: 'A cool hacker girl',
    avatar: '/alice.png',
    followUrls: [bob.url, carla.url],
    follows: [{name: 'Bob', url: bob.url}, {name: 'Carla', url: carla.url}]
  })
  t.deepEqual(await session.getProfile(bob), {
    _origin: bob.url,
    _url: bob.url + '/profile.json',
    name: 'Bob',
    bio: 'A cool hacker guy',
    avatar: '/avatar.jpg',
    followUrls: [alice.url],
    follows: [{name: 'Alice', url: alice.url}]
  })
  t.deepEqual(await session.getProfile(carla), {
    _origin: carla.url,
    _url: carla.url + '/profile.json',
    name: 'Carla',
    bio: null,
    avatar: null,
    followUrls: [alice.url],
    follows: [{url: alice.url, name: null}]
  })

  await session.close()
})
