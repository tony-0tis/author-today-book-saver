#!/usr/bin/env node
import puppeteer from 'puppeteer';
import pretty from 'pretty';
import {argv} from 'process';
import {writeFileSync} from 'fs';
import {exec as ex} from 'child_process';
import {promisify} from 'util';
import {join} from 'path';
import {createInterface} from 'readline';
import waterfallTasks from 'waterfall-tasks';

const exec = promisify(ex);
const readline = createInterface({
  input: process.stdin,
  output: process.stdout
});

class authorTodayBookSaver {
  browser = null;
  browserPage = null;

  book = {
    name: null,
    author: null,
    chapters: [],
  };

  constructor(){
  }

  async init(url, headless=true, cookies){
    this.browser = await puppeteer.launch({headless: headless? 'new' : false});
    //crete new page
    this.page = await this.browser.newPage();
    // Set screen size
    await this.page.setViewport({width: 1080, height: 1024});
    if(cookies) {
      cookies = cookies.split(';').map(str=>{
        const [name, value] = str.split('=');

        return {
          name: name.trim(),
          value: value.trim(),
          domain: 'author.today'
        };
      }, {});
      await this.page.setCookie(...cookies);
    }

    return await this._obtainBookInfo(url);
  }
  async continue(){
    if(this.book.chapters.length){
      for(let chapter of this.book.chapters){
        await this._savePage(chapter);
      }
    }

    await this.browser.close();
  }
  async _obtainBookInfo(bookUrl){
    debugger;
    if(!bookUrl) {
      console.error('>>> Cannot navigate to invalid URL', bookUrl);
      return;
    }
    console.log('>>> open book', bookUrl);
    await this.page.goto(bookUrl, {waitUntil: 'domcontentloaded'});

    const name = await this.page.$('.book-title');
    if(!name){
      console.error('>>> Paste the URL of the book, not the URL of the page of the book');
      return false;
    }

    this.book.author = await this.page.$eval('.book-authors', div=> div.innerText);
    this.book.name = await this.page.$eval('.book-title', div=> div.innerText);
    this.book.chapters = await this.page.$eval('#tab-chapters', div=>{
      return [...div.querySelectorAll('li')].map(li=>{
        const link = li.querySelector('a');
        if(link){
          return {
            link: link.href,
            val: link.innerText
          }  
        }
        else{
          return {
            val: String(li.innerText).replace(/\n/g, '').trim().replace(/\s{2,}/g, ' ')
          }
        }
      });
    });

    if(this.book.chapters.find(chapter=>!chapter.link)){
      return false;
    }
    return true;
  }
  async _savePage(chapter){
    //debugger;
    console.log(`>>> open chapter ${chapter.link}(${chapter.val})`);
    await this.page.goto(chapter.link, {waitUntil: 'domcontentloaded'});

    await this.page.waitForSelector('#text-container h1');

    chapter.text = await this.page.$eval('#text-container', div=>{
      return div.innerHTML;
    });
  }
  saveBook(pathToSave = './'){
    const html = `<html xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta charset="utf-8">
        <style type="text/css">
          h1{page-break-before: always;}
        </style>
      </head>
      <body>
        ${this.book.chapters.map(chapter=>{
          return `<section>${chapter.text}</section>`;
        }).join('')}
      </body>
    </html>`;

    const fileToSave = (this.book.author + ' - ' + this.book.name).replace(/:/g, ' -');
    try{
      console.log('>>> save book to', join(pathToSave, fileToSave + '.html'));
      writeFileSync(join(pathToSave, fileToSave + '.html'), pretty(html));
    }catch(e){
      console.error('>>> on save', e);
    }
  }
  async convert(calibreConverter){
    const fileToSave = (this.book.author + ' - ' + this.book.name).replace(/:/g, ' -');
    const {stdout, stderr} = await exec(`${calibreConverter} "${fileToSave}.html" "${fileToSave}.fb2"`);
    console.error('stderr:', stderr.toString());
    console.log('stdout:', stdout.toString());
  }
}

const authorToday = new authorTodayBookSaver();
waterfallTasks([
  cb=>{
    readline.question('# Start the browser in windowless mode? y|n (default: y): ', answer=>{
      cb(null, answer.toLowerCase() !== 'n');
    });
  },
  (cb, headless)=>{
    readline.question('\n# If necessary, insert a cookie (format: key1=val1;key2=val2): ', cookies=>{
      cb(null, headless, cookies);
    });
  },
  (cb, headless, cookies)=>{
    readline.question('\n# Enter the book address of author.today: ', async url=>{
      const next = await authorToday.init(url, headless, cookies);
      cb(null, next);
    });
  },
  (cb, next)=>{
    if(next) return cb(null, true);

    readline.question('\n# Not all pages are available for download. Do you want to download only the available ones? y|n (default: n): ', answer=>{
      cb(null, answer.toLowerCase() === 'y')
    });
  },
  async (cb, next)=>{
    if(!next) return cb('\n# Canceling the save');

    await authorToday.continue();

    readline.question('\n# Specify the path for saving the book (in the current directory by default): ', path=>{
      authorToday.saveBook(path || './');
      cb();
    });
  },
  cb=>{
    readline.question('\n# Specify the path to Calibre/ebook-convert.exe. If you leave it blank, the book will remain in html format: ', async calibreConverter=>{
      if(calibreConverter){
        await authorToday.convert(calibreConverter);
      }
      cb();
    });
  }
], data=>{
  readline.close();
  console.log('\n# Save complete\n')
});
