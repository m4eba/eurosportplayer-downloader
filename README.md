download videos from eurosportplayer.com

### Prerequisites

* video/audio streams are encrypted you need mp4decrypt in your PATH. Download it from here https://www.bento4.com/
* use also need ffmpeg in PATH to join video and audio.
* node.js to run the tool http://nodejs.org

### chromium vs google-chrome
The video playback won't start with the chromium build shipped with puppeteer.
see https://github.com/puppeteer/puppeteer#q-what-features-does-puppeteer-not-support.
Use the chrome-exec flag with a google chrome executable.

### reCaptcha v3
Unfortunately the login is protected with reCaptcha and an empty chrome profile will trigger it.
So until there is an integration with some anti captcha service the best way to deal with it at them moment is to reuse a profile directory with --user-data-dir and use the --debug flag for the first time to solve the captcha manually. :(

```bash
$ node download.js -c google-chrome -e EMAIL -p PASSWORD -d -a profile --login-timeout 120000 http://eurosportplayer.com
```
solve the captcha to login and close chrome (don't ctrl+c!)
then reuse with
```bash
$ node download.js -c google-chrome -a profile [urls to download]
```

### Options
    -h, --help                      show usage guide
    -e, --email EMAIL               email for login
    -p, --password PASSWORD         password for login
    -d, --debug                     run in debug mode
    -c, --chrome-exec PATH          chrome executable
    -a, --user-data-dir PATH        user-data-dir for chrome instance
    -l, --login-timeout NUMBER      set the timeout in msec for the login process (Default: 30000)
    -t, --tmp PATH                  temp directory for download data (Default: tmp)
    -o, --out PATH                  output directory for video
    -u, --url URL                   urls to download              


