const path = require("path");
const puppeteer = require("puppeteer");
const commandLineUsage = require("command-line-usage");
const commandLineArgs = require("command-line-args");
const sanitize = require("sanitize-filename");
const uniquefilename = require("uniquefilename");
const fetch = require("node-fetch");
const hls_download = require("./hls");

const opt = [
  {
    name: "help",
    alias: "h",
    description: "show this usage guide",
    type: Boolean,
  },
  {
    name: "email",
    alias: "e",
    typeLabel: "{underline email}",
    description: "email for login",
    type: String,
  },
  {
    name: "password",
    alias: "p",
    typeLabel: "{underline password}",
    description: "password for login",
    type: String,
  },
  {
    name: "debug",
    alias: "d",
    description: "run in debug mode",
    type: Boolean,
  },
  {
    name: "chrome-exec",
    alias: "c",
    typeLabel: "{underline path to executable}",
    description: "chrome executable",
    type: String,
  },
  {
    name: "user-data-dir",
    alias: "a",
    typeLabel: "{underline directory}",
    description: "user-data-dir for chrome instance",
    type: String,
  },
  {
    name: "login-timeout",
    typeLabel: "{underline timeout in msec}",
    defaultValue: 30000,
    description: "set the timeout for the login process",
    type: Number,
  },
  {
    name: "tmp",
    alias: "t",
    typeLabel: "{underline directory}",
    description: "temp directory for download data (Default: tmp)",
    defaultValue: "tmp",
    type: String,
  },
  {
    name: "out",
    alias: "o",
    typeLabel: "{underline directory}",
    description: "output directory for video",
    defaultValue: "./",
    type: String,
  },
  {
    name: "language",
    alias: "l",
    typeLabel: "{underline language}",
    description:
      "audio language: eng(default),deu,cze,gre,hun,ita,por,ron,rus,tur",
    defaultValue: "eng",
    type: String,
  },
  {
    name: "keep-tmp-files",
    description: "don't delete temporary files",
    type: Boolean,
  },
  {
    name: "url",
    alias: "u",
    typeLabel: "{underline url}",
    description: "urls to download",
    multiple: true,
    defaultOption: true,
    type: String,
  },
];
const sections = [
  {
    header: "Download from eurosportplayer.com",
    content: [
      "Uses puppeteer to get m3u8 url. Then uses ffmpeg (must be in PATH)",
      "to download the video and audio stream into a temporary directory.",
      "Finally both are joined with ffmpeg.",
    ],
  },
  {
    header: "reCaptcha v3",
    content: [
      "Unfortunately the login is protected with reCaptcha and an empty chrome profile will in most cases trigger it.",
      "So until there is an integration with some anti captcha service the best way to deal with it at them moment is to reuse a profile directory with --user-data-dir and use the --debug flag for the first time to solve the captcha manually. :(",
      "",
      "node download.js -c google-chrome -e email -p pass -d -a profile --login-timeout 120000 http://eurosportplayer.com",
      "solve the captcha to login and close chrome (don't ctrl+c!)",
      "then reuse with",
      "node download.js -c google-chrome -a profile http://....",
    ],
  },
  {
    header: "Options",
    optionList: opt,
  },
];

const args = commandLineArgs(opt);
if (args.help | (args.url === undefined)) {
  console.log(commandLineUsage(sections));
  process.exit(0);
}

let config = {};

if (args.debug == true) {
  config = {
    slowMo: 100,
    devtools: true,
  };
}

if (args["chrome-exec"]) {
  config.executablePath = args["chrome-exec"];
}
if (args["user-data-dir"]) {
  config.userDataDir = args["user-data-dir"];
}

async function setup() {
  try {
    const browser = await puppeteer.launch(config);
    return browser;
  } catch (e) {
    console.log("unable to setup browser", e);
    process.exit(1);
  }
}

async function testLoggedIn(browser) {
  const page = await browser.newPage();
  page.setViewport({ width: 1280, height: 720 });

  await page.goto("https://auth.eurosportplayer.com/my-account");
  await page.waitFor(2000);
  const idx = await page.evaluate('document.body.innerHTML.search("Sign in")');

  await page.close();
  return idx < 0;
}

async function login(browser) {
  if (!args.email) {
    console.log("need email to login");
    process.exit(1);
  }
  if (!args.password) {
    console.log("need password to login");
    process.exit(1);
  }
  try {
    const page = await browser.newPage();
    page.setViewport({ width: 1280, height: 720 });

    await page.goto("https://auth.eurosportplayer.com/login?flow=login");
    await page.waitFor('button[type="submit"]');
    await page.waitFor(3000);
    await page.type("#email", args.email);
    await page.type("#password", args.password);
    await page.$$eval('button[type="submit"]', (sub) => sub[0].click());
    await page.waitForSelector('button[class*="styles-authButton"]', {
      timeout: args["login-timeout"],
    });
    await page.close();
  } catch (e) {
    console.log("unable to login", e);
    process.exit(1);
  }
}

async function video(browser, url) {
  let result = {
    url: null,
    m3u8: null,
  };

  const page = await browser.newPage();
  page.setViewport({ width: 1280, height: 720 });

  await page.goto(url);
  const m3u8 = await page.waitForResponse(
    (response) => response.url().indexOf("index.m3u8") > 0,
    { timeout: 10000 }
  );
  result.url = m3u8.url();
  if (m3u8.ok()) result.m3u8 = await m3u8.text();
  await page.waitFor('[data-sonic-attribute="title"]');
  result.title = await page.$eval(
    '[data-sonic-attribute="title"]',
    (d) => d.innerHTML
  );
  const date = await page.$eval(
    '[data-sonic-attribute="publish-date"]',
    (d) => d.innerHTML
  );
  result.date = date.trim();
  result.time = "";

  await page.close();

  return result;
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
      let params = null;

      let tries = 0;
      while (tries++ < 15) {
        try {
          params = await video(browser, url);
          break;
        } catch (e) {
          console.log(e);
        }
      }
      // exit if params not returned
      if (params === null) {
        console.log(`unable to get m3u8 url for ${url}`);
        process.exit(1);
      }

      // the m3u8 gets a lot of 403 returns :(
      // fetch it, if empty
      if (params.m3u8 === null) {
        let count = 0;
        while (count++ < 10) {
          console.log("retry", params.url);
          const resp = await fetch(params.url);
          console.log(resp.ok, resp.statusText);
          if (resp.ok) {
            params.m3u8 = await resp.text();
            break;
          }
        }
      }
      console.log(params);
      if (params.m3u8 === null) {
        console.log(`unable to get m3u8 for ${url}`);
        process.exit(1);
      }

      let filename = sanitize(
        params.date + " - " + params.time + " " + params.title + ".mp4"
      );
      filename = await uniquefilename.get(
        path.join(args.out, filename.trim()),
        {}
      );

      await hls_download(params, filename, args);
    }
    await browser.close();
  } catch (e) {
    console.log(e);
  }
})();
