/**
 * Created by lzw on 14-8-4.
 */
var Admin = AV.Object.extend('Admin');
var _ = require('underscore');
var Thread = AV.Object.extend('Thread');
var Ticket = AV.Object.extend('Ticket');
var TicketNotification = AV.Object.extend('TicketNotification');
var mlog = require('cloud/mlog.js');
var mutil = require('cloud/mutil.js');
var muser = require('cloud/muser.js');

function findEmailsByType(type) {
  var p = new AV.Promise();
  var q = new AV.Query(Admin);
  q.equalTo('types', type);
  q.include('user');
  q.find({
    success: function (admins) {
      var es = [];
      admins.forEach(function (admin) {
        es.push(admin.get('user').get('email'));
      });
      p.resolve(es);
    },
    error: mutil.rejectFn(p)
  });
  return p;
}

function findAll(clzName, modifyQueryFn) {
  var Clz = AV.Object.extend(clzName);
  var q = new AV.Query(Clz);
  var res = [];
  var p = new AV.Promise();
  if (modifyQueryFn) {
    modifyQueryFn(q);
  }
  q.count({
      success: function (cnt) {
        var t = (cnt + 999) / 1000;  //I'm so clever!
        t = Math.floor(t);  //But...
        var promises = [];
        for (var i = 0; i < t; i++) {
          var skip = i * 1000;
          var q = new AV.Query(Clz);
          q.ascending('createdAt');
          q.limit(1000);
          if (modifyQueryFn) {
            modifyQueryFn(q);
          }
          q.skip(skip);
          promises.push(q.find({
            success: function (lines) {
              res = res.concat(lines);
              return AV.Promise.as(res);
            }
          }));
        }
        AV.Promise.when(promises).then(function () {
          p.resolve(res);
        }, mutil.rejectFn(p));
      },
      error: mutil.rejectFn(p)
    }
  );
  return p;
}

function transformAdmin(admin) {
  var email = admin.get('user').get('email');
  return{
    id: admin.id,
    cid:admin.get('user').id,
    name: admin.get('user').get('username'),
    email: email,
    types: admin.get('types'),
    username: admin.get('user').get('username'),
    qq: admin.get('user').get('qq'),
    weekTicketNum: 0,
    allTicketNum: 0,
    weekReplyNum: 0,
    allReplyNum: 0
  };
}

function findAdminById(id) {
  var q = new AV.Query(Admin);
  q.include('user');
  return q.get(id);
}

function findCleanAdminById(id) {
  return findAdminById(id).then(function (admin) {
    mlog.log('find admin');
    if (admin) {
      admin = transformAdmin(admin);
    }
    return AV.Promise.as(admin);
  });
}

function addOrDelArrItem(id, arrName, item) {
  var p = new AV.Promise();
  findAdminById(id).then(function (admin) {
    var names = admin.get(arrName);
    var i = names.indexOf(item);
    if (i >= 0) {
      admin.remove(arrName, item);
    } else {
      admin.add(arrName, item);
    }
    admin.save().then(function () {
      p.resolve();
    }, mutil.rejectFn(p));
  }, mutil.rejectFn(p));
  return p;
}

function addOrDelAdmin(username){
  var p=new AV.Promise();
  muser.findUserByName(username).then(function(user){
    if(user){
      findAdmins(function(q){
        q.equalTo('user',user);
      }).then(function(admins){
        var admin;
        if(admins.length>0){
          admin=admins[0];
          admin.destroy().then(function(){
            p.resolve();
          },mutil.rejectFn(p));
        }else{
          admin=new Admin();
          admin.set('types',[]);
          admin.set('user',user);
          admin.save().then(function(){
            p.resolve();
          },mutil.rejectFn(p));
        }
      },mutil.rejectFn(p));
    }else{
      p.reject(new Error('该用户不存在'));
    }
  },mutil.rejectFn(p));
  return p;
}

function addOrDelType(id, type) {
  return addOrDelArrItem(id, 'types', type);
}

function deleteNotifications(p, ticket, id, threadN) {
  var qn = new AV.Query(TicketNotification);
  qn.contains('link', id);
  qn.find().then(function (notis) {
    var nn = notis.length;
    var nps = [];
    _.each(notis, function (noti) {
      nps.push(noti.destroy());
    });
    AV.Promise.when(nps).then(function () {
      console.log('destroy ticket ' + ticket.get('title'));
      ticket.destroy().then(function () {
        p.resolve([threadN, nn]);
      }, mutil.rejectFn(p));
    }, mutil.rejectFn(p));
  }, mutil.rejectFn(p));
}

function deleteTicket(id) {
  var p = new AV.Promise();
  var q = new AV.Query(Ticket);
  q.get(id).then(function (ticket) {
    var tq = new AV.Query(Thread);
    tq.equalTo('ticket', ticket);
    tq.find().then(function (threads) {
      var ps = [];
      var threadN = threads.length;
      _.each(threads, function (thread) {
        ps.push(thread.destroy());
      });
      AV.Promise.when(ps).then(function () {
        deleteNotifications(p, ticket, id, threadN);
      }, mutil.rejectFn(p));
    }, mutil.rejectFn(p));
  }, mutil.rejectFn(p));
  return p;
}

function findAdmins(modifyQueryFn) {
  return findAll('Admin', function (q) {
    q.include('user');
    if(modifyQueryFn){
      modifyQueryFn(q);
    }
  });
}

function findCleanAdmins() {
  var p = new AV.Promise();
  findAdmins().then(function (admins) {
    admins = _.map(admins, transformAdmin);
    p.resolve(admins);
  }, mutil.rejectFn(p));
  return p;
}

exports.findEmailsByType = findEmailsByType;
exports.findAll = findAll;
exports.findAdminById = findAdminById;
exports.transformAdmin = transformAdmin;
exports.addOrDelType = addOrDelType;
exports.deleteTicket = deleteTicket;
exports.findAdmins = findAdmins;
exports.findCleanAdmins = findCleanAdmins;
exports.findCleanAdminById = findCleanAdminById;
exports.addOrDelAdmin=addOrDelAdmin;
