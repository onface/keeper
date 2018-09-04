const express = require('express')
const app = express()
const path =require('path')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('data/db.json')
const db = low(adapter)
const bodyParser = require('body-parser')
const urlencodedParser = bodyParser.urlencoded({ extended: false })
const session = require('express-session')
const schedule = require('node-schedule');
const request = require('request')
const cookieParser = require('cookie-parser')
const delayEach = require('delayeach')
const extend = require('safe-extend')
const fecha = require('fecha')
db.defaults(require('./defaultDataBase'))
  .write()
app.use(urlencodedParser)
app.use(cookieParser('keeper'))
app.set('trust proxy', 1) // trust first proxy
app.use(session({
  secret: 'keeper',
  resave: true,
  saveUninitialized: true
}))
function checkLogin (req, res, next) {
    if(!req.session.login) {
        res.send({
            type: 'needLogin'
        })
        return
    }
    else {
        next();return
    }
}
app.use(function checkPassword (req, res, next) {
  var ignorePath = ['/start.html', '/setPassword']
  if (ignorePath.includes(req.path)) {
      next()
      return
  }
  const password = db.get('admin.password').value()
  if (!password) {
      res.redirect('/start.html')
  }
  else {
      next()
  }
})
app.post('/setPassword', function (req, res, next) {
    if (db.get('admin.password').value()) {
        res.send({
            type: 'fail',
            msg: '已经设置过密码了！'
        })
    }
    else if (!req.body.password.trim()) {
        res.send({
            type: 'fail',
            msg: '密码必填'
        })
    }
    else {
        db.set('admin.password', req.body.password)
            .write()
        req.session.login = true
        res.send({
            type: 'pass'
        })
    }
    next()
})
app.get('/list', checkLogin, function (req, res, next) {
    res.send({
        type: 'pass',
        data: db.get('page').value().map(function (item){
            return {
                status: item.status,
                url: item.url,
                checkDate: item.checkDate,
                msg: item.msg,
                mobiles: item.mobiles
            }
        })
    })
    return
})
app.post('/add', checkLogin, function (req, res, next) {
        var matchUrl = new RegExp("((^http)|(^https)|(^ftp)):\/\/(\\w)+\.(\\w)+")
        if (!matchUrl.test(req.body.url)) {
            res.send({
                type: 'fail',
                msg: '请输入一个正确的网址，前缀要有 http:// 或者 https:// 哦'
            })
            next();return
        }
        db.get('page')
            .push({
                url: req.body.url,
                status: 200,
                mobiles: req.body.mobiles
            })
            .write()
        res.send({type: 'pass'})
        next();return
})
app.post('/remove', function (req, res, next) {
    db.set(
        'page',
        db.get('page').value().filter(function (item){
            return item.url !== req.body.url
        })
    ).write()
    res.send({type: 'pass'})
})
app.get('/database', function (req, res) {
    if (req.session.login) {
        res.type('.text')
        res.send(JSON.stringify({
            type: 'pass',
            data: db.value()
        }, null, 4))
    }
    else {
        res.send({
            type:'fail'
        })
    }
})
app.post('/login', function (req, res, next) {
    let password = db.get('admin.password').value()
    if (password !== req.body.password) {
        res.send({
            type: 'fail',
            msg: '密码错啦'
        })
    }
    else {
        req.session.login = true
        res.send({
            type: 'pass'
        })
    }
})
app.use(express.static('public'))
const port = 4121
app.listen(port, function () {
    console.log('http://127.0.0.1:' + port)
})

require('events').EventEmitter.prototype._maxListeners = 100;


function getNowDateFormat () {
    return fecha.format(new Date(), 'YYYY-MM-DD HH:mm:ss')
}
function task () {
        if (db.get('page').value().length === 0 ) {
            setTimeout(function() {
                task()
            }, 1000)
            return
        }
        var calledNewTask = false
        function emitNewTask () {
            if (calledNewTask) {
                return
            }
            calledNewTask = true
            setTimeout(task, 5000)
        }
        setTimeout(function () {
            if (calledNewTask === false) {
                console.log('强制进入下一个任务')
                console.log(JSON.stringify(db.get('logs').value()))
                emitNewTask()
            }
        }, 1000*60*20)
        delayEach(
            db.get('page').value(),
            function (item, index, next, finish) {
                var checkDate = getNowDateFormat()
                var calledNext = false
                function emitNext () {
                    if (calledNext) {
                        return
                    }
                    calledNext = true
                    next()
                }
                var id = require('cuid')()
                if (db.get('logs').value().length > 1000) {
                    db.set('logs', []).write()
                }
                db.get('logs').push({
                    id: id,
                    url: item.url,
                    type: 'request start',
                    time: getNowDateFormat()
                }).write()
                request.get(item.url, function (err, res, body) {
                    db.get('logs').push({
                        id: id,
                        url: item.url,
                        type: 'request end',
                        time: getNowDateFormat()
                    }).write()
                    let data = extend.clone(db.get('page').find({url: item.url}).value())
                    data.checkDate = checkDate
                    if (err || typeof res === 'undefined') {
                        data.status = 404
                        data.msg = JSON.stringify(err)
                    }
                    else {
                        data.status = res.statusCode
                    }
                    if (data.status >= 400) {
                        data.errorCount = data.errorCount || 0
                        data.errorCount++
                        if (data.errorCount > 5) {
                            data.sendSmsCount = data.sendSmsCount || 0
                            if (data.sendSmsCount > 3) {
                                emitNext()
                                return
                            }
                            var sendId = require('cuid')()
                            db.get('logs').push({
                                id: sendId,
                                url: item.url,
                                type: 'send sms start',
                                time: getNowDateFormat()
                            }).write()
                            request({
                                method: 'POST',
                                url: 'http://www.emailcar.net/v2/sms_send',
                                formData: {
                                    api_user: process.env.SMS_API_USER || '',
                                    api_pwd: process.env.SMS_API_PWD || '',
                                    mobiles: item.mobiles,
                                    sign: 'EmailCar',
                                    content: '监控报警:'+ item.url + ' 无法访问，服务器状态码:' + data.status
                                }
                            }, function (err, res, body) {
                                var sendId = require('cuid')()
                                db.get('logs').push({
                                    id: sendId,
                                    url: item.url,
                                    type: 'send sms end',
                                    body: body,
                                    time: getNowDateFormat()
                                }).write()
                                var resData = {}
                                try{
                                    resData = JSON.parse(body)
                                }
                                catch (e) {
                                    resData= {
                                        status: 'error',
                                        msg: '短信接口json格式错误' + e.message + ' json  ' + body
                                    }
                                }
                                if (err) {
                                    console.log('send sms api error: ' + err)
                                    res.resData.msg = JSON.stringify(err)
                                }
                                if (resData.status === 'error') {
                                    data.msg = '短信接口错误： ' + resData.msg + getNowDateFormat()
                                }
                                else {
                                    data.msg = '短信提醒已发送' + getNowDateFormat()
                                    data.sendSmsCount++
                                }
                                db.get('page').find({url: item.url}).assign(data).write()
                                emitNext()
                            })
                        }
                        else {
                            db.get('page').find({url: item.url}).assign(data).write()
                            emitNext()
                        }
                    }
                    else {
                        data.msg = ''
                        data.sendSmsCount = 0
                        data.errorCount = 0
                        db.get('page').find({url: item.url}).assign(data).write()
                        emitNext()
                    }
                })
                setTimeout(function () {
                    if (calledNext === false) {
                        console.log('强制进入下一个请求')
                        console.log(JSON.stringify(db.get('logs').value()))
                        emitNext()
                    }
                }, 10000)
            },
            function () {
                emitNewTask()
            }
        )
}
task()
