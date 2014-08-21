/**
 * Created by lzw on 14-8-7.
 */

var _ = require('underscore');
var anonymousToken = 'anonymous';
var anonymousCid = 'anonymousCid';
var mlog = require('cloud/mlog.js');
var muser = require('cloud/muser.js');
var mutil = require('cloud/mutil.js');
var madmin = require('cloud/madmin.js');

function setResLoginStatus(res, isLogin, client) {
  res.locals.isLogin = isLogin;
  res.locals.mClient = client;
}

function renderEmailVerify(res, email) {
  res.render('verify_email', {email: email});
}

function findClient(req, res, f) {
  var curUser = AV.User.current();
  if (curUser) {
    var user = muser.transfromUser(curUser);
    setResLoginStatus(res, true, user);
    f.call(this, user.token, user.id, user);
  } else {
    var anonymousClient = {
      id: anonymousCid,
      username: '匿名用户',
      email: req.body.email,
      token: anonymousToken
    };
    setResLoginStatus(res, false, anonymousClient);
    f.call(this, anonymousToken, anonymousCid, anonymousClient);
  }
}

function isAdmin(cid) {
  var p = new AV.Promise();
  var user = AV.Object.createWithoutData('_User', cid);
  madmin.findAdmins(function (q) {
    q.equalTo('user', user);
  }).then(function (admins) {
    if (admins && admins.length > 0) {
      p.resolve(true);
    } else {
      p.resolve(false);
    }
  }, mutil.rejectFn(p));
  return p;
}

exports.clientTokenParser = function () {
  return function (req, res, next) {
    var regs = [/\.css$/, /^\/fonts\//, /\.js$/, /\.ico$/, /^\/images/];
    var isStatic = _.some(regs, function (reg) {
      return reg.test(req.url);
    });

    if (isStatic) {
      next();
    } else {
      mlog.log('req url ' + req.url);
      findClient(req, res, function (token, cid, client) {
        mlog.log('find client');
        req.token = token;
        req.cid = cid;
        req.client = client;
        mlog.log('find cid=' + req.cid);
        isAdmin(cid).then(function (isAdmin) {
          req.admin = isAdmin;
          if (req.cid != anonymousCid && client.emailVerified == false) {
            if (/^\/requestEmailVerify/.test(req.url)) {
              next();
            } else {
              renderEmailVerify(res, client.email);
            }
          } else {
            if (/^\/admin.*/.test(req.url)) {
              if (isAdmin) {
                next();
              } else {
                mlog.log('isn\'t not admin');
                mutil.renderForbidden(res);
              }
            }else{
              next();
            }
          }
        }, mutil.renderErrorFn(res));
      });
    }
  };
};

function isLogin() {
  return AV.User.current();
}

exports.findClient = findClient;
exports.anonymousToken = anonymousToken;
exports.anonymousCid = anonymousCid;
exports.isLogin = isLogin;
exports.isAdmin = isAdmin;
exports.renderEmailVerify = renderEmailVerify;