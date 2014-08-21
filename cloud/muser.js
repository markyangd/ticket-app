/**
 * Created by lzw on 14-8-8.
 */
var User = AV.Object.extend('_User');
var mlog = require('cloud/mlog.js');
var mutil=require('cloud/mutil.js');

function findUser(queryFn) {
  var q = new AV.Query(User);
  queryFn.call(this, q);
  return q.first();
}

function findRawClientByEmail(email) {
  return findUser(function (q) {
    q.equalTo('email', email);
  });
}

function findRawUserById(id) {
  return findUser(function (q) {
    q.equalTo('objectId', id);
  });
}

function findUserById(id) {
  return findRawUserById(id).then(function (c) {
    if (c) {
      c = transfromUser(c);
    }
    return AV.Promise.as(c);
  });
}

function findUserByEmail(email) {
  var p = new AV.Promise();
  findRawClientByEmail(email).then(function (user) {
    if (user) {
      var user = transfromUser(user);
      p.resolve(user);
    } else {
      p.resolve();
    }
  },mutil.rejectFn(p));
  return p;
}

function updateCurUser(map) {
  var user=AV.User.current();
  if (map.email) {
    user.set('email', map.email);
  }
  if (map.username) {
    user.set('username', map.username);
  }
  if (map.qq) {
    map.qq = parseInt(map.qq);
    mlog.log('update qq');
    user.set('qq', map.qq);
  }
  return user.save();
}

function transfromUser(curUser) {
  return {
    username:curUser.get('username'),
    id:curUser.id,
    qq:curUser.get('qq'),
    email:curUser.get('email'),
    token:curUser.get('sessionToken'),
    emailVerified:curUser.get('emailVerified')
  };
}

function findUserByName(name){
  return findUser(function(q){
    q.equalTo('username',name)
  });
}

exports.findUserByEmail = findUserByEmail;
exports.findUserById = findUserById;
exports.findRawUserById=findRawUserById;
exports.transfromUser=transfromUser;
exports.updateCurUser=updateCurUser;
exports.findUserByName=findUserByName;