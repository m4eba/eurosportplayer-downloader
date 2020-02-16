download videos from eurosportplayer.com

### Prerequisites

* use need ffmpeg in PATH to download/join video and audio.
* node.js to run the tool http://nodejs.org

### reCaptcha v3
Unfortunately the login is protected with reCaptcha and an empty chrome profile will trigger it.
So until there is an integration with some anti captcha service the best way to deal with it at them moment is to reuse a profile directory with --user-data-dir and use the --debug flag for the first time to solve the captcha manually. :(

```bash
$ node download.js -e EMAIL -p PASSWORD -d -a profile --login-timeout 120000 http://eurosportplayer.com
```
solve the captcha to login and close chrome (don't ctrl+c!)
then reuse with
```bash
$ node download.js -a profile [urls to download]
```

### Options
    -h, --help                      show usage guide
    -e, --email EMAIL               email for login
    -p, --password PASSWORD         password for login
    -l, --language LANGUAGE         audio language: eng(default),deu,cze,gre,hun,ita,por,ron,rus,tur
    -d, --debug                     run in debug mode
    -c, --chrome-exec PATH          chrome executable
    -a, --user-data-dir PATH        user-data-dir for chrome instance
        --login-timeout NUMBER      set the timeout in msec for the login process (Default: 30000)
    -t, --tmp PATH                  temp directory for download data (Default: tmp)
    -o, --out PATH                  output directory for video
    -u, --url URL                   urls to download              


