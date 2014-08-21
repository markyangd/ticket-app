var express = require('express');
var app = express();
var Mailgun = require('mailgun').Mailgun;
var util = require('util');
var expressLayouts = require('express-ejs-layouts');
var moment = require('moment');
var _ = require('underscore');
var fs = require('fs');
var avosExpressHttpsRedirect = require('avos-express-https-redirect');
var crypto = require('crypto');

var admin = require('cloud/madmin.js');
var login = require('cloud/login.js');
var mticket = require('cloud/mticket.js');
var mlog = require('cloud/mlog.js');
var muser = require('cloud/muser.js');
var mutil = require('cloud/mutil.js');
var config = require('cloud/config.js');
var _s = require('underscore.string');

// App全局配置
if (__production)
  app.set('views', 'cloud/views');
else
  app.set('views', 'cloud/views');

app.set('view engine', 'ejs');    // 设置template引擎
app.use(avosExpressHttpsRedirect());
app.use(express.bodyParser());    // 读取请求body的中间件
app.use(express.cookieParser(config.cookieParserSalt));
app.use(expressLayouts);
app.use(login.clientTokenParser());
app.use(app.router);
//app.use(login.clientTokenParser());

var todo_status = 0;
var processing_status = 1;
var done_status = 2;

var open_content = 1;
var secret_content = 0;

var mailgunKey = config.mailGunKey;
var mg = new Mailgun(mailgunKey);

var slackUrl = config.slackUrl;
var anonymousCid = login.anonymousCid;
var Ticket = AV.Object.extend('Ticket');
var Thread = AV.Object.extend('Thread');
var adminPrefix = 'AVOS Cloud -- ';
var type2showMap = {
  "ios": "iOS SDK",
  "android": "Android SDK",
  "javascript": "JavaScript SDK",
  "push": "消息推送",
  "cloud": "云代码",
  "stats": "统计",
  "dashboard": "开发者平台",
  "other": "其他"
};

function renderStatus(status) {
  switch (status) {
    case 0:
      return "等待处理";
    case 1:
      return "已回复";
    case 2:
      return "完成";
    default:
      return "未知状态";
  }
}

var renderError = mutil.renderError;
var renderErrorFn = mutil.renderErrorFn;
var renderForbidden = mlog.renderForbidden;
var renderInfo = mutil.renderInfo;

function checkAdmin(req, res, next) {
  var cid = req.cid;
  var isAdmin=req.admin;
  if (isAdmin == false) {
    renderForbidden(res);
    return;
  }
  next();
}

function saveFileThen(req, f) {
  if (req.files == null) {
    f()
    return;
  }
  var attachmentFile = req.files.attachment;
  if (attachmentFile && attachmentFile.name != '') {
    fs.readFile(attachmentFile.path, function (err, data) {
      if (err)
        return f();
      //var base64Data = data.toString('base64');
      var theFile = new AV.File(attachmentFile.name, data);
      theFile.save().then(function (theFile) {
        f(theFile);
      }, function (err) {
        f();
      });
    });
  } else {
    f();
  }
}

function attachmentUrl(obj) {
  var attachment = obj.get('attachment');
  if (attachment)
    return '<p><a href="' + attachment.url() + '" target="_blank" title="查看附件"><img src="' + attachment.url() + '"></a></p>'
}

function getTicketId(t) {
  var id = t.get('tid');
  if (id) {
    return  id;
  } else {
    return -1;
  }
}

//统计平均时间显示格式
function transformTime(averagetime) {
  var result = "";
  //ms -> s
  averagetime /= 1000;

  if (averagetime > 60) {
    //ms -> s
    averagetime /= 60;
    if (averagetime > 60) {
      var hour = averagetime / 60;
      averagetime = averagetime % 60;
      result = hour.toFixed(0) + " 小时 " + averagetime.toFixed(0) + " 分钟";
    }
    else {
      result = averagetime.toFixed(0) + " 分钟";
    }
  }
  else
    result = averagetime.toFixed(0) + " 秒";
  return result;
}

function transformSearchTicket(t) {
  return {
    id: t.objectId,
    tid: t.tid,
    ticket_id: t.tid,
    title: t.title,
    type: type2showMap[t.type],
    createdAt: moment(t.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    createdAtUnix: moment(t.createdAt).valueOf()
  };
}

function formatTime(t) {
  var date = moment(t).fromNow();
  var cleanDate = "<span class='form-cell-date'>" + moment(t).format('YYYY-MM-DD') + "</span> <span class='form-cell-time'>" + moment(t).format('HH:mm:ss') + "</span>";
  return date;
}

function formatTimeLong(t) {
  var date = moment(t).format('YYYY-MM-DD HH:mm:ss');
  return date;
}

function transformTicket(t) {
  var rawStatus = t.get('status');
  var open = secret_content;
  if (t.get('open') == open_content) {
    open = open_content;
  }
  var type = type2showMap[t.get('type')];
  if (type == undefined) {
    type = '未知';
  }
  return {
    id: t.id,
    ticket_id: getTicketId(t),
    title: t.get('title'),
    type: type,
    content: t.get('content'),
    status: renderStatus(rawStatus),
    rawStatus: rawStatus,
    cid: t.get('cid'),
    attachment: attachmentUrl(t),
    createdAt: formatTime(t.createdAt),
    createdAtLong: formatTimeLong(t.createdAt),
    createdAtUnix: moment(t.createdAt).valueOf(),
    open: open
  };
}


function transformThread(t) {
  var user = t.get("user") || 'Anonymous';
  return {
    id: t.id,
    cid: t.get('cid'),
    content: t.get("content"),
    user: user,
    attachment: attachmentUrl(t),
    open: t.get('open'),
    createdAt: moment(t.createdAt).fromNow(),
    createdAtLong: moment(t.createdAt).format('YYYY-MM-DD HH:mm:ss')
  };
}

function genAdminTicketLink(ticket) {
  return config.hostUrl + '/tickets/' + ticket.id + '/threads';
}

function generateAdminReplyLink(ticket) {
  var link = genAdminTicketLink(ticket);
  return _s.sprintf('<p><a href="%s">Click Here</a> for details</p>', link);
}

function genSlackLink(ticket) {
  var link = genAdminTicketLink(ticket);
  return _s.sprintf('\n<%s|Click here for detail! >', link);
}

function sendEmail(ticket, subject, text, email) {
  var type = ticket.get('type');
  admin.findEmailsByType(type).then(function (emails) {
    var to;
    if (email) {
      to = email;
    } else {
      if (emails) {
        to = emails.join(',');
      }
    }
    if (__production && to) {
      mg.sendRaw(_s.sprintf('AVOS Cloud Ticket System <%s>', config.emailHost),
        [to],
          'From:' + config.emailHost +
          '\nTo: ' + to +
          '\nContent-Type: text/html; charset=utf-8' +
          '\nSubject: ' + subject +
          '\n\n' + text,
        function (err) {
          err && console.log(err)
        });
    } else {
      mlog.log(text + 'email= ' + to);
    }
  }, mutil.logErrorFn());
}

function transformNotification(n) {
  return {
    message: n.get('message'),
    link: n.get('link'),
    createdAt: n.createdAt.getTime()
  };
}

function addNotify(link, cid, msg) {
  console.log(link + ' ' + cid);
  var n = new AV.Object('TicketNotification');
  n.set('cid', cid);
  n.set('link', link);
  if (msg)
    n.set('message', msg);
  n.save().then(function () {
  }, mutil.logErrorFn());
}

//使用express路由API服务/hello的http GET请求
app.get('/tickets', function (req, res) {
  var token = req.token;
  var cid = req.cid;
  var isAdmin=req.admin;
  if (isAdmin) {
    //enter admin page.
    res.redirect('/admin/tickets');
  } else {
    var query = new AV.Query("Ticket");
    query.ascending("status");
    query.descending("createdAt");
    query.equalTo("cid", cid);
    query.find().then(function (tickets) {
      tickets = tickets || [];
      tickets = _.map(tickets, transformTicket);
      res.render('list', {tickets: tickets, token: token});
    }, mutil.renderErrorFn(res));
  }
});

app.get('/history', function (req, res) {
  var cid = req.cid;
  var isAdmin=req.admin;
  if (isAdmin) {
    res.redirect('/admin/history');
  } else {
    var skip = req.query.skip;
    if (skip == null) {
      skip = 0;
    }
    var limit = 100;
    var type = req.query.type;
    var query = new AV.Query("Ticket");
    query.equalTo('status', done_status);
    if (type != null)
      query.equalTo('type', type);
    query.limit(limit);
    query.skip(skip);
    query.descending("createdAt");
    query.find().then(function (tickets) {
      tickets = tickets || [];
      tickets = _.map(tickets, transformTicket);
      var back = -1;
      var next = -1;
      if (parseInt(skip) > 0)
        back = parseInt(skip) - parseInt(limit);
      if (tickets.length == limit)
        next = parseInt(skip) + parseInt(limit);
      res.render('history', {tickets: tickets, back: back, next: next, type: type});
    }, renderErrorFn(res));
  }
});

app.get('/notifications', function (req, res) {
  var token = req.token;
  var cid = req.cid;
  var lastDate = req.query.lastDate;
  var query = new AV.Query('TicketNotification');
  query.equalTo('cid', cid);
  if (lastDate) {
    query.greaterThan('createdAt', new Date(parseInt(lastDate)));
  }
  query.descending('createdAt');
  query.find().then(function (results) {
    results = _.map(results, transformNotification);
    res.send({ results: results});
  }, renderErrorFn(res));
});

app.get('/tickets/new', function (req, res) {
  var token = req.token;
  var client = req.client;
  res.render('new', {token: token, client: client});
});

app.get('/admin/tickets', function (req, res) {
  var token = req.token;
  var client = req.client;
  var email = client.email;
  var skip = req.query.skip;
  var status = req.query.status;
  if (skip == null) {
    skip = 0;
  }
  var limit = 100;
  admin.findAdmins().then(function (admins) {
    admins = _.map(admins, admin.transformAdmin);
    var thisAdmin;
    _.each(admins, function (admin) {
      //mlog.log('this admin='+admin.email);
      //mlog.log('email='+email);
      if (admin.email == email) {
        thisAdmin = admin;
      }
    });
    //mlog.log('this '+thisAdmin.types);
    var query = new AV.Query("Ticket");
    if (!status) {
      query.lessThan('status', done_status);
      query.limit(limit);
    }
    else {
      query.equalTo('status', parseInt(status));
    }

    query.skip(skip);
    query.descending("createdAt");
    query.find().then(function (tickets) {
      tickets = tickets || [];
      //归属Ticket
      if (status) {
        var filters = _.filter(tickets, function (t) {
          //mlog.log(t.get('type')+' ticket type');
          if (thisAdmin && thisAdmin.types.indexOf(t.get('type')) != -1) {
            return true;
          } else {
            return false;
          }
        });
        if (thisAdmin) {
          tickets = filters;
        }
      }
      tickets = _.map(tickets, transformTicket);

      var back = -1;
      var next = -1;

      if (parseInt(skip) > 0)
        back = parseInt(skip) - parseInt(limit);
      if (tickets.length == limit)
        next = parseInt(skip) + parseInt(limit);
      if (status == null)
        status = "";
      res.render('admin_list', {tickets: tickets, token: token, email: email,
        status: status, back: back, next: next });
    }, renderErrorFn(res));
  }, renderErrorFn(res));
});

app.get('/admin/history', function (req, res) {
  var token = req.token;
  var limit = 100;
  var type = req.query.type;
  var skip = req.query.skip;
  if (skip == null) {
    skip = 0;
  }
  var searchcontent = req.query.searchcontent;
  var query = new AV.Query("Ticket");
  query.equalTo('status', done_status);
  if (type != null)
    query.equalTo('type', type);
  if (searchcontent != null) {

    AV.Cloud.httpRequest({
      url: 'https://cn.avoscloud.com/1/search/select?limit=200&clazz=Ticket&q=' + searchcontent,
      headers: {
        'Content-Type': 'application/json',
        'X-AVOSCloud-Application-Id': config.applicationId,
        'X-AVOSCloud-Application-Key': config.applicationKey,
      },
      success: function (httpResponse) {
        var back = -1;
        var next = -1;
        tickets = JSON.parse(httpResponse.text).results || [];
        tickets = _.map(tickets, transformSearchTicket);
        //renderError(res, tickets);
        res.render('admin_history', {tickets: tickets, back: back, next: next, type: type});
        //console.log(httpResponse.text);
      },
      error: function (httpResponse) {
        renderError(res, "Search error." + searchcontent);
        //console.error('Request failed with response code ' + httpResponse.status);
      }
    });
  } else {
    query.limit(limit);
    query.descending("createdAt");
    query.skip(skip);
    query.find().then(function (tickets) {
      tickets = tickets || [];
      //renderError(res, tickets);
      tickets = _.map(tickets, transformTicket);
      var back = -1;
      var next = -1;
      if (parseInt(skip) > 0)
        back = parseInt(skip) - parseInt(limit);
      if (tickets.length == limit)
        next = parseInt(skip) + parseInt(limit);
      res.render('admin_history', {tickets: tickets, token: token, back: back, next: next, type: type});
    }, renderErrorFn(res));
  }
});

function isThisWeek(timeStr) {
  var now = new Date();
  diffDays = moment(now.toLocaleDateString()).diff(moment(timeStr), 'days');
  return diffDays < 8;
}

function getStatisticsEachType(admins, ticketThreads) {
  var week = [];
  var allhistory = [];
  var type2name = {};
  for (var type in type2showMap) {
    type2name[type] = [];
    admins.forEach(function (admin) {
      if (admin.types.indexOf(type) >= 0) {
        type2name[type].push(admin.username);
      }
    });
  }

  for (var type in type2showMap) {
    var tts = _.filter(ticketThreads, function (tt) {
      var t = tt.ticket;
      return t.get('status') == done_status && t.get('type') == type;
    });
    tts = tts || [];
    var replynum = 0;
    var averagetime = 0;
    var showtype = "";
    var adminname = "";
    var ticketnum = tts.length;
    var currentTicketNum = 0;

    var weekTicketNum = 0;
    var weekReplyNum = 0;
    var weekAverageTime = 0;
    for (var i in  tts) {
      t = tts[i].ticket;
      var ticketType = t.get('type');
      showtype = type2showMap[ticketType];
      adminname = type2name[ticketType];
      var inweek = false;
      var creatdAt = t.createdAt;
      var isInWeek = isThisWeek(creatdAt);
      if (isInWeek) {
        inweek = true;
        weekTicketNum += 1;
      }
      var threads = tts[i].threads;
      var currentthreadnum = 0;
      threads = threads || [];
      _.each(threads, function (th) {
        replynum += 1;
        if (inweek)
          weekReplyNum += 1;
        currentthreadnum += 1;
        if (currentthreadnum == 1) {
          averagetime += moment(th.createdAt).diff(moment(t.createdAt));
          if (inweek)
            weekAverageTime += moment(th.createdAt).diff(moment(t.createdAt));
        }
      });

      currentTicketNum += 1;
      if (currentTicketNum == ticketnum) {
        if (ticketnum > 0) {
          averagetime = averagetime / ticketnum;
        }
        if (weekTicketNum > 0) {
          weekAverageTime = weekAverageTime / weekTicketNum;
        }

        var data = {
          type: showtype,
          admin: adminname,
          ticketnum: ticketnum,
          replynum: replynum,
          averageTime: transformTime(averagetime),
          averageTimeUnix: averagetime
        };
        allhistory.push(data);

        data = {
          type: showtype,
          admin: adminname,
          ticketnum: weekTicketNum,
          replynum: weekReplyNum,
          averageTime: transformTime(weekAverageTime),
          averageTimeUnix: weekAverageTime
        };
        week.push(data);

      }
    }

  }
  return {week: week, allhistory: allhistory};
}

function getStatisticsEachAdmin(admins, ticketThreads) {
  admins.forEach(function (admin) {
    for (var i in ticketThreads) {
      var tt = ticketThreads[i];
      var find = false;
      tt.threads.forEach(function (thread) {
        if (admin.cid == thread.get('cid')) {
          find = true;
          if (isThisWeek(thread.createdAt)) {
            admin.weekReplyNum++;
          }
          admin.allReplyNum++;
        }
      });
      if (find) {
        if (isThisWeek(tt.ticket.createdAt)) {
          admin.weekTicketNum++;
        }
        admin.allTicketNum++;
      }
    }
  });
}

app.get('/admin/statistics', function (req, res) {
  var token = req.token;
  admin.findAdmins().then(function (admins) {
    admins = _.map(admins, admin.transformAdmin);
    var allTickets;
    var allThreads;
    var promises = [];
    promises.push(admin.findAll('Ticket').then(function (tickets) {
      allTickets = tickets;
    }));
    promises.push(admin.findAll('Thread').then(function (threads) {
      allThreads = threads;
    }));
    //mlog.log('find all');
    AV.Promise.when(promises).then(function () {
      var ticketThreads = [];
      var used = new Array(allThreads.length);
      for (var i = 0; i < used.length; i++) {
        used[i] = false;
      }
      allTickets.forEach(function (ticket) {
        var threads = [];
        for (var i = 0; i < allThreads.length; i++) {
          var thread = allThreads[i];
          if (used[i] == false && thread.get('ticket').id == ticket.id) {
            used[i] = true;
            threads.push(thread);
          }
        }
        ticketThreads.push({ticket: ticket, threads: threads});
      });
      var __ret = getStatisticsEachType(admins, ticketThreads);
      getStatisticsEachAdmin(admins, ticketThreads);
      //mlog.log(admins);
      res.render('admin_statistics', {token: token, week: __ret.week, allhistory: __ret.allhistory, admins: admins});
    }, mutil.renderErrorFn(res));
  }, mutil.renderErrorFn(res));
});

function judgeVisibleForOne(open, isAdmin, cid, ticketCid) {
  if (open == open_content || isAdmin || ticketCid == anonymousCid || cid == ticketCid) {
    return true;
  } else {
    return false;
  }
}

function judgeVisible(threads, isAdmin, cid, ticketCid) {
  _.each(threads, function (thread) {
    thread.visible = judgeVisibleForOne(thread.open, isAdmin, cid, ticketCid);
  });
}

function findMyLastOpen(admin, ticket, threads) {
  var i = threads.length - 1;
  while (i >= 0) {
    var th = threads[i];
    if (admin) {
      if (th.user.indexOf('AVOS Cloud') != -1) {
        return th.open;
      }
    } else {
      if (th.user.indexOf('AVOS Cloud') == -1) {
        return th.open;
      }
    }
    i--;
  }
  if (admin) {
    return open_content;
  } else {
    return ticket.open;
  }
}

function genQQLink(isAdmin, ticketCid, visitCid, threads) {
  var p = new AV.Promise();
  if (isAdmin) {
    muser.findUserById(ticketCid).then(function (c) {
      if (c && c.qq) {
        p.resolve('/clients/' + ticketCid);
      } else {
        p.resolve(null);
      }
    }, mutil.rejectFn(p));
  } else {
    if (ticketCid == visitCid) {
      admin.findCleanAdmins().then(function (admins) {
        for (var i = threads.length - 1; i >= 0; i--) {
          var thread = threads[i];
          for (var j = 0; j < admins.length; j++) {
            var admin = admins[j];
            mlog.log('cid=' + admin.cid + '  ' + thread.cid);
            if (thread.cid == admin.cid) {
              p.resolve('/engineers/' + admin.id);
              return;
            }
          }
        }
        p.resolve();
      }, mutil.rejectFn(p));
    } else {
      p.resolve();
    }
  }
  return p;
}

app.get('/tickets/:id/threads', function (req, res) {
  var ticketId = req.params.id;
  var token = req.token;
  var cid = req.cid;
  var query = new AV.Query("Thread");
  query.ascending("createdAt");
  query.equalTo("ticket", AV.Object.createWithoutData("Ticket", ticketId));
  query.find().then(function (threads) {
    var ticket = AV.Object.createWithoutData("Ticket", ticketId);
    ticket.fetch().then(function (ticket) {
      if (isTicketEmpty(ticket) == false) {
        ticket = transformTicket(ticket);
        threads = _.map(threads, transformThread);
        var isAdmin = req.admin;
        var open = ticket.open;
        ticket.visible = judgeVisibleForOne(open, isAdmin, cid, ticket.cid);
        judgeVisible(threads, isAdmin, cid, ticket.cid);
        var lastOpen = findMyLastOpen(isAdmin, ticket, threads);
        genQQLink(isAdmin, ticket.cid, cid, threads).then(function (qqLink) {
          mlog.log('qqlink' + qqLink);
          res.render("edit", { ticket: ticket, token: token, threads: threads,
            admin: isAdmin, cid: cid, lastOpen: lastOpen, qqLink: qqLink});
        }, mutil.renderErrorFn(res));
      } else {
        renderError(res, "找不到工单，该工单可能已经被删除");
      }
    }, renderErrorFn(res));
  }, renderErrorFn(res));
});

var closeMsg = '关闭了 AVOS Cloud 上的工单，如果还有问题请及时联系。';
function sendClientEmail(ticket, html) {
  var ticketSeq = getTicketId(ticket);
  var link = 'http://ticket.avosapps.com/tickets/' + ticket.id + '/threads';
  html = html + "<br/><p>请直接 <a href='" + link + "' target='_blank'>点击这里</a> 进入 AVOS Cloud 技术支持系统回复。</p>" +
    "<p>谢谢，AVOS Cloud Team</p>";
  sendEmail(ticket, "AVOS Cloud 技术支持工单" + ticketSeq + " 更新", html, ticket.get('client_email'));
}

function sendCloseEmail(ticket) {
  sendClientEmail(ticket, closeMsg);
}

function truncateContent(content) {
  var len = content.length;
  if (len <= 20) {
    return content;
  } else {
    return content.substring(0, 20) + '...';
  }
}

function isTicketEmpty(ticket) {
  return !ticket || ticket.get('title') == null;
}

app.post('/tickets/:id/threads', function (req, res) {
  var cid = req.cid;
  var client = req.client;
  var token = req.token;
  var ticketId = req.params.id;
  var ticket = AV.Object.createWithoutData("Ticket", ticketId);
  ticket.fetch().then(function (ticket) {
    if (isTicketEmpty(ticket) == false) {
      //864 is administrator's client id
      var isAdmin=req.admin;
      if (ticket.get('cid') != cid && !isAdmin) {
        renderError(res, "非法的客户端，请不要回复他人的工单");
      } else {
        if (ticket.get('status') == done_status) {
        } else {
          var ticketSeq = getTicketId(ticket);
          saveFileThen(req, function (attachment) {
            var thread = new AV.Object('Thread');
            if (attachment) {
              thread.set("attachment", attachment);
            }
            thread.set('ticket', AV.Object.createWithoutData("Ticket", ticketId));
            var username = client.username;
            var close = req.body.close;
            var secret = req.body.secret;
            mlog.log('secret=' + secret);
            isAdmin = req.admin;
            if (isAdmin) {
              username = adminPrefix + username;
            }
            thread.set('user', username);
            thread.set('cid', cid);
            var content = req.body.content;
            if (isAdmin) {
              var html;
              if (close == '1') {
                if (content == null || content == '') {
                  content = closeMsg;
                }
                html = content;
                ticket.set('status', done_status);
                ticket.save();
              } else {
                html = '<p>' + req.client.username +
                  '回复到：</p> <p><pre> ' + content + " </pre></p>";
                ticket.set('status', processing_status);
                ticket.save();
              }
              if (ticket.get('status') == done_status) {
                notifyTicketToChat(ticket, '', '管理员关闭了工单。');
              }
              sendClientEmail(ticket, html, ticketSeq);
              addNotify('http://ticket.avosapps.com/tickets/' + ticket.id + '/threads', cid);
            } else {
              if (close == '1') {
                if (content == null || content == '') {
                  content = closeMsg;
                }
                ticket.set('status', done_status);
                ticket.save();
              } else {
                //update client token and status
                ticket.set('client_token', token);
                ticket.set('status', todo_status);
                ticket.save();
              }
              var text = "<p>Client: client.username </p><p>Title:   <pre>" + ticket.get('title') + "</pre></p><p>Reply:  <pre>" + content + "</pre></p>";
              text = text + generateAdminReplyLink(ticket);
              sendEmail(ticket, "New reply thread", text);
              notifyTicketToChat(ticket, content, '工单新回复！');
            }
            thread.set('content', content);
            if (secret) {
              thread.set('open', secret_content);
            } else {
              thread.set('open', open_content);
            }
            thread.save().then(function () {
              res.redirect("/tickets/" + ticketId + "/threads");
            }, renderErrorFn(res));
          });
        }
      }
    } else {
      renderError(res, "找不到工单");
    }
  }, renderErrorFn(res));
});

function notifySlack(text, type) {
  if (__production == false) {
    mlog.log('type=' + type);
    mlog.log(text);
    return;
  }
  AV.Cloud.httpRequest({
    method: 'POST',
    timeout: 15000,
    url: slackUrl,
    body: JSON.stringify({
      username: type,
      text: text,
      icon_url: 'https://cn.avoscloud.com/images/static/press/Logo%20Avatar.png'
    }),
    error: function (httpResponse) {
      console.error('Request failed with response  ' + httpResponse.text);
    }
  });
}

function validateEmail(email) {
  var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(email);
}

function notifyTicketToChat(ticket, content, info) {
  var part = '';
  if (content && content != '') {
    part = '    内容：' + truncateContent(content);
  }
  var hipChatText = info + '   ' + ticket.get('title') + part;
  var type = type2showMap[ticket.get('type')];
  notifySlack(hipChatText + genSlackLink(ticket), type);
}

function createTicket(res, token, client, attachment, title, type, content, secret, then) {
  mticket.incTicketNReturnOrigin().then(function (n) {
    var ticket = new AV.Object("Ticket");
    if (attachment) {
      ticket.set("attachment", attachment);
    }
    mlog.log('secret=' + secret);
    if (secret) {
      ticket.set('open', secret_content);
    } else {
      ticket.set('open', open_content);
    }
    ticket.set("cid", client.id);
    ticket.set('client_email', client.email);
    ticket.set('type', type);
    ticket.set('client_token', token);
    ticket.set("status", todo_status);
    ticket.set("title", title);
    ticket.set("content", content);
    ticket.set('tid', n);
    ticket.save().then(function (ticket) {
      var text = "<p>Client:  " + client.username + "</p><p> Type:  " + type + "</p><p> Title:  <pre>" + title + "</pre></p><p>Content:  <pre>" + content + "</pre></p>";
      text += generateAdminReplyLink(ticket);
      sendEmail(ticket, "New ticket", text);
      var info = "新的工单！";
      notifyTicketToChat(ticket, content, info);
      then(ticket);
    }, renderErrorFn(res));
  });
}

app.post('/tickets', function (req, res) {
  var token = req.token;
  var cid = req.cid;
  var client = req.client;
  mlog.log('req title' + req.body.title);
  if (!client.email || !validateEmail(client.email)) {
    return renderError(res, "请提供有效的电子邮箱地址，方便我们将反馈通知给您。");
  }
  saveFileThen(req, function (attachment) {
    createTicket(res, token, client, attachment, req.body.title, req.body.type, req.body.content, req.body.secret, function (ticket) {
      res.redirect("/tickets");
    });
  });
});

function uniqTickets(ts) {
  return _.uniq(ts, false, function (item, key, a) {
    if (item == null) {
      return null;
    } else {
      return item.id;
    }
  });
}

function getAdminReplyN() {
  var q = new AV.Query(Thread);
  q.startsWith('user', 'AVOS');
  return q.count();
}

app.get('/search', function (req, res) {
  var content = req.query.content;
  if (content == null || content == '') {
    res.redirect('/search?content=AVObject&page=1');
    return;
  }
  var page = req.query.page;
  if (!page) {
    page = '1';
    res.redirect('search?content=' + encodeURI(content) + '&page=1');
    return;
  }
  page = parseInt(page);
  if (page < 1) page = 1;
  var skip = (page - 1) * 10;
  var total = skip + 10;
  mlog.log('c=' + content);
  var searchContent = content;
  mlog.log('c=' + searchContent);
  getAdminReplyN().then(function (threadsN) {
    AV.Cloud.httpRequest({
      url: 'https://cn.avoscloud.com/1.1/search/select?limit=' + total + '&clazz=Ticket&q=' + searchContent,
      headers: {
        'Content-Type': 'application/json',
        'X-AVOSCloud-Application-Id': config.applicationId,
        'X-AVOSCloud-Application-Key': config.applicationKey
      },
      success: function (httpResponse) {
        var resText = httpResponse.text;
        var ticketJson = JSON.parse(resText);
        //mlog.log(ticketJson);
        var sid = ticketJson.sid;
        tickets = ticketJson.results || [];
        tickets = tickets.splice(skip);
        tickets = _.map(tickets, transformSearchTicket);
        //renderError(res, tickets);
        //res.render('search', {tickets: tickets, content:content ,threadsN:threadsN,searchPage:true});
        var url = 'https://cn.avoscloud.com/search/select/?hl=true&fl=url,title&hl.fl=title,content&' +
          'start=' + skip + '&limit=10&wt=json&hl.alternateField=content&hl.maxAlternateFieldLength=250&q=' + searchContent;
        AV.Cloud.httpRequest({
          url: url,
          success: function (resp) {
            var doc = resp.text;
            doc = JSON.parse(doc);
            var docs = doc.response.docs;
            _.each(docs, function (doc) {
              //mlog.log(doc.title);
            });
            var prevPage, nextPage;
            if (page > 1) {
              prevPage = page - 1;
            } else {
              prevPage = 1;
            }
            nextPage = page + 1;
            res.render('search', {tickets: tickets, content: content, threadsN: threadsN,
              searchPage: true, docs: docs, page: page, prevPage: prevPage, nextPage: nextPage});
          },
          error: function (err) {
            mlog.log(err);
            console.error('search doc error:' + httpResponse.error);
          }
        });
      },
      error: function (httpResponse) {
        renderError(res, "Search error." + httpResponse);
        console.error('Request failed with response code ' + httpResponse.text);
      }
    });
  });
  //searchWithRegex(content, res);
});

app.get('/admin/detail/:id', function (req, res) {
  var id = req.params.id;
  admin.findAdminById(id).then(function (_sa) {
    sa = admin.transformAdmin(_sa);
    addTypeName(sa);
    res.render('admin_detail', {admin: sa, type2showMap: type2showMap});
  });
});

app.post('/admin/detail/:id', function (req, res) {
  var id = req.params.id;
  var type = req.body.type;

  function redirect() {
    res.redirect('/admin/detail/' + id);
  }

  if (type) {
    admin.addOrDelType(id, type)
      .then(function () {
        redirect();
      });
  }
});

app.post('/tickets/:id/delete', function (req, res) {
  checkAdmin(req, res, function () {
    var id = req.params.id;
    admin.deleteTicket(id).then(function (result) {
      var tn = result[0];
      var nn = result[1];
      renderInfo(res, '同时删除了' + tn + '个消息回复与' + nn + '个消息提醒', '/tickets');
    });
  });
});

function addTypeName(admin) {
  admin.typeNames = [];
  _.each(admin.types, function (type) {
    admin.typeNames.push(type2showMap[type]);
  });
  admin.typeName = admin.typeNames.join('，');
}

app.get('/contact', function (req, res) {
  var cid = req.cid;
  var client = req.client;
  admin.findAdmins().then(function (admins) {
    admins = _.map(admins, admin.transformAdmin);
    _.each(admins, addTypeName);
    isAdmin = req.admin;
    res.render('contact', {admins: admins, isAdmin: isAdmin, client: client});
  }, mutil.renderErrorFn(res));
});

app.get('/login', function (req, res) {
  if (login.isLogin(req)) {
    res.redirect('/tickets');
  } else {
    res.render('login.ejs');
  }
});

app.post('/register', function (req, res) {
  var username = req.body.username;
  var password = req.body.password;
  var email = req.body.email;
  if (username && password && email) {
    var user = new AV.User();
    user.set('username', username);
    user.set('password', password);
    user.set('email', email);
    user.signUp(null).then(function (user) {
      login.renderEmailVerify(res, email);
    }, function (error) {
      renderInfo(res, util.inspect(error));
    });
  } else {
    mutil.renderError(res, '不能为空');
  }
});

app.post('/login', function (req, res) {
  var username = req.body.username;
  var password = req.body.password;
  AV.User.logIn(username, password, {
    success: function (user) {
      res.redirect('/tickets');
    },
    error: function (user, error) {
      mutil.renderError(res, error.message);
    }
  });
});

app.get('/register', function (req, res) {
  if (login.isLogin(req)) {
    res.redirect('/tickets');
  } else {
    res.render('register.ejs');
  }
});

function judgeDetailVisible(isAdmin, detailCid, visistCid) {
  if (isAdmin) {
    return AV.Promise.as(isAdmin);
  }
  return login.isAdmin(detailCid).then(function (isAdminDetail) {
    if (isAdminDetail || detailCid == visistCid) {
      return AV.Promise.as(true);
    } else {
      return AV.Promise.as(false);
    }
  });
}

app.get('/clients/:id', function (req, res) {
  var cid = req.cid;
  var id = req.params.id;
  if (judgeDetailVisible(req.admin,id, cid)) {
    muser.findUserById(id).then(function (client) {
      if (client) {
        res.render('client_detail', {client: client});
      } else {
        renderInfo(res, '此用户并未建立用户信息');
      }
    }, mutil.renderErrorFn(res));
  } else {
    renderForbidden(res);
  }
});

function isAdminOrMe(isAdmin,contentId, visitId) {
  return isAdmin || contentId == visitId;
}


app.post('/clients/:id', function (req, res) {
  var cid = req.cid;
  var id = req.params.id;
  var is = isAdminOrMe(req.admin, id, cid);
  if (is) {
    muser.updateCurUser(req.body).then(function () {
      res.redirect('/contact');
    }, mutil.renderErrorFn(res));
  } else {
    renderForbidden(res);
  }
});

app.get('/engineers/:id', function (req, res) {
  var id = req.params.id;
  admin.findCleanAdminById(id).then(function (admin) {
    if (admin) {
      addTypeName(admin);
      res.render('admin_open_detail', {admin: admin});
    } else {
      renderError(res, '对不起，未找到该工程师的信息。');
    }
  }, mutil.renderErrorFn(res));
});

function testFn(fn, res) {
  fn.call(this).then(function () {
    res.send('ok');
  }, mutil.renderErrorFn(res));
}

app.get('/logout', function (req, res) {
  AV.User.logOut();
  res.redirect('/tickets');
});

app.get('/', function (req, res) {
  res.redirect('/tickets');
});

app.get('/google', function (req, res) {
  var content = req.query.content;
  res.redirect('https://www.google.com.hk/search?q=site%3Ahttps%3A%2F%2Fticket.avosapps.com+' + content);
});

app.get('/requestEmailVerify', function (req, res) {
  var email = req.query.email;
  AV.User.requestEmailVerfiy(email).then(function () {
    mutil.renderInfo(res, '邮件已发送请查收。');
  }, mutil.renderErrorFn(res));
});

app.post('/admin',function(req,res){
  var username=req.body.username;
  admin.addOrDelAdmin(username).then(function(){
    res.redirect('/contact');
  },mutil.renderErrorFn(res));
});

app.get('/test', function (req, res) {
});


//最后，必须有这行代码来使express响应http请求
app.listen({"static": {maxAge: 604800000}});

exports.todo_status = todo_status;
exports.processing_status = processing_status;
exports.done_status = done_status;
exports.sendCloseEmail = sendCloseEmail;
exports.notifyTicketToChat = notifyTicketToChat;
exports.generateAdminReplyLink = generateAdminReplyLink;
exports.transfromTime = transformTime;
