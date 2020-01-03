const path = require('path');
const puppeteer = require('puppeteer-core');
const commandLineUsage = require('command-line-usage');
const commandLineArgs = require('command-line-args');
const sanitize = require("sanitize-filename");
const uniquefilename = require('uniquefilename');
const dash_download = require('./dash');

const opt = [
  {
    name: 'help',
    alias: 'h',
    description: 'show this usage guide',
    type: Boolean
  },
  {
    name: 'email',
    alias: 'e',
    typeLabel: '{underline email}',
    description: 'email for login',
    type: String
  },
  {
    name: 'password',
    alias: 'p',
    typeLabel: '{underline password}',
    description: 'password for login',
    type: String
  },
  {
    name: 'debug',
    alias: 'd',
    description: 'run in debug mode',
    type: Boolean
  },
  {
    name: 'chrome-exec',
    alias: 'c',
    typeLabel: '{underline path to executable}',
    description: 'chrome executable',
    type: String
  },
  {
    name: 'user-data-dir',
    alias: 'a',
    typeLabel: '{underline directory}',
    description: 'user-data-dir for chrome instance',
    type: String
  },
  {
    name: 'login-timeout',
    typeLabel: '{underline timeout in msec}',
    defaultValue: 30000,
    description: 'set the timeout for the login process',
    type: Number
  },
  {
    name: 'tmp',
    alias: 't',
    typeLabel: '{underline directory}',
    description: 'temp directory for download data (Default: tmp)',
    defaultValue: 'tmp',
    type: String
  },
  {
    name: 'out',
    alias: 'o',
    typeLabel: '{underline directory}',
    description: 'output directory for video',
    defaultValue: './',
    type: String
  },
  {
    name: 'language',
    alias: 'l',
    typeLabel: '{underline language}',
    description: 'audio language: eng(default),deu,cze,gre,hun,ita,por,ron,rus,tur',
    defaultValue: 'eng',
    type: String
  },
  {
    name: 'url',
    alias: 'u',
    typeLabel: '{underline url}',
    description: 'urls to download',
    multiple: true,
    defaultOption: true,
    type: String
  }
]
const sections = [
  {
    header: 'Download from eurosportplayer.com',
    content: [
      'Uses puppeteer to get dash manifest url and the key for decryption.',
      'Then downloads the video and audio stream into a temporary directory.',
      'Both are decrypted with mp4decrypt from bento4.com (must be in PATH).',
      'And joined with ffmpeg (also must be in PATH)'
    ]
  },
  {
    header: 'chromium vs google-chrome',
    content: [
      'The video playback won\'t start with the chromium build shipped with puppeteer.',
      'see https://github.com/puppeteer/puppeteer#q-what-features-does-puppeteer-not-support',
      'Use the chrome-exec flag with google chrome executable'
    ]
  },
  {
    header: 'reCaptcha v3',
    content: [
      'Unfortunately the login is protected with reCaptcha and an empty chrome profile will in most cases trigger it.',
      'So until there is an integration with some anti captcha service the best way to deal with it at them moment is to reuse a profile directory with --user-data-dir and use the --debug flag for the first time to solve the captcha manually. :(',
      '',
      'node download.js -c google-chrome -e email -p pass -d -a profile --login-timeout 120000 http://eurosportplayer.com',
      'solve the captcha to login and close chrome (don\'t ctrl+c!)',
      'then reuse with',
      'node download.js -c google-chrome -a profile http://....'
    ]
  },
  {
    header: 'Options',
    optionList: opt
  }
];

const args = commandLineArgs(opt);
if (args.help | args.url === undefined) {
  console.log(commandLineUsage(sections));
  process.exit(0);
}

let config = {};

if (args.debug == true) {
  config = {
    slowMo: 100,
    devtools: true
  };
}


if (args['chrome-exec']) {
  config.executablePath = args['chrome-exec'];
} else {
  console.log('chrome executable required, set it with chrome-exec, see --help');
  process.exit(1);
}
if (args['user-data-dir']) {
  config.userDataDir = args['user-data-dir'];
}


async function setup() {
  try {
    const browser = await puppeteer.launch(config);
    return browser;
  } catch (e) {
    console.log('unable to setup browser', e);
    process.exit(1);
  }
}



async function testLoggedIn(browser) {
  const page = await browser.newPage();
  page.setViewport({ width: 1280, height: 720 });

  await page.goto('https://auth.eurosportplayer.com/my-account');
  await page.waitFor(2000);
  const idx = await page.evaluate('document.body.innerHTML.search("Sign in")');

  await page.close();
  return idx < 0;
}

async function login(browser) {
  if (!args.email) {
    console.log('need email to login');
    process.exit(1);
  }
  if (!args.password) {
    console.log('need password to login');
    process.exit(1);
  }
  try {
    const page = await browser.newPage();
    page.setViewport({ width: 1280, height: 720 });

    await page.goto('https://auth.eurosportplayer.com/login?flow=login');
    await page.waitFor('button[type="submit"]');
    await page.waitFor(3000);
    await page.type('#email', args.email);
    await page.type('#password', args.password);
    await page.$$eval('button[type="submit"]', sub => sub[0].click());
    await page.waitForSelector('button[class*="styles-authButton"]', {
      timeout: args['login-timeout']
    });
    await page.close();
  } catch (e) {
    console.log('unable to login', e);
    process.exit(1);
  }
}

async function video(browser, url) {
  const p = new Promise(async function (resolve, reject) {
    let result = {
      url: null
    };
    let page = null;
    let count = 0;


    let rcb = function (r) {
      if (r.url().indexOf('index.mpd') > 0) {
        result.url = r.url();
        done();
      }
    }
    let rescb = async function (res) {
      if (res.request().url().indexOf('clearkey') > 0) {
        result.key = await res.text();
        done();
      }
    }


    page = await browser.newPage();


    page.setViewport({ width: 1280, height: 720 });
    page.on('request', rcb);
    page.on('response', rescb);
    await page.goto(url);
    await page.waitFor('[data-sonic-attribute="title"]');
    result.title = await page.$eval('[data-sonic-attribute="title"]', d => d.innerHTML);
    const date = await page.$eval('[data-sonic-attribute="publish-date"]', d => d.innerHTML);
    result.date = date.trim();
    result.time = '';
    done();

    function done() {
      if (++count == 3) {
        page.removeListener('request', rcb);
        page.removeListener('response', rescb);
        page.close().then(() => resolve(result));
      }
    }

  });
  return p;
}


(async () => {

  try {
    const browser = await setup();

    const loggedIn = await testLoggedIn(browser);
    if (!loggedIn) {
      await login(browser);
    }

    for (let i = 0; i < args.url.length; ++i) {
      const url = args.url[i];
      const params = await video(browser, url);
      console.log(params);

      let filename = sanitize(params.date + ' - ' + params.time + ' ' + params.title + '.mp4');
      filename = await uniquefilename.get(path.join(args.out, filename.trim()), {});

      let keyData = null;
      try {
        keyData = JSON.parse(params.key);
      } catch (e) {
        console.log('unable to parse key data from ', params.key);
        process.exit(1);
      }
      const buf = Buffer.from(keyData.keys[0].k, 'base64');
      const key = buf.toString('hex');
      console.log('key', key);
      await dash_download(params.url, filename, key, args);
    }
    await browser.close();
  } catch (e) {
    console.log(e);
  }

})();

