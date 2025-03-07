/* eslint-env jest */
/* global browserName */
import webdriver from 'next-webdriver'
import { readFileSync } from 'fs'
import http from 'http'
import url from 'url'
import { join } from 'path'
import { getBrowserBodyText, waitFor, fetchViaHTTP } from 'next-test-utils'
import { recursiveReadDir } from 'next/dist/lib/recursive-readdir'
import { homedir } from 'os'

// Does the same evaluation checking for INJECTED for 5 seconds after hydration, triggering every 500ms
async function checkInjected(browser) {
  const start = Date.now()
  while (Date.now() - start < 5000) {
    const bodyText = await getBrowserBodyText(browser)
    if (/INJECTED/.test(bodyText)) {
      throw new Error('Vulnerable to XSS attacks')
    }
    await waitFor(500)
  }
}

module.exports = (context) => {
  describe('With Security Related Issues', () => {
    it.skip('should handle invalid URL properly', async () => {
      async function invalidRequest() {
        return new Promise((resolve, reject) => {
          const request = http.request(
            {
              hostname: `localhost`,
              port: context.appPort,
              path: `*`,
            },
            (response) => {
              resolve(response.statusCode)
            }
          )
          request.on('error', (err) => reject(err))
          request.end()
        })
      }
      try {
        expect(await invalidRequest()).toBe(400)
        expect(await invalidRequest()).toBe(400)
      } catch (err) {
        // eslint-disable-next-line
        expect(err.code).toBe('ECONNREFUSED')
      }
    })

    it('should only access files inside .next directory', async () => {
      const buildId = readFileSync(join(__dirname, '../.next/BUILD_ID'), 'utf8')

      const pathsToCheck = [
        `/_next/${buildId}/page/../../../info`,
        `/_next/${buildId}/page/../../../info.js`,
        `/_next/${buildId}/page/../../../info.json`,
        `/_next/:buildId/webpack/chunks/../../../info.json`,
        `/_next/:buildId/webpack/../../../info.json`,
        `/_next/../../../info.json`,
        `/static/../../../info.json`,
        `/static/../info.json`,
        `/../../../info.json`,
        `/../../info.json`,
        `/../info.json`,
        `/info.json`,
      ]

      for (const path of pathsToCheck) {
        const res = await fetchViaHTTP(context.appPort, path)
        const data = await res.text()
        expect(data.includes('cool-version')).toBeFalsy()
        expect([400, 404].includes(res.status)).toBeTruthy()
      }
    })

    it('should not allow accessing files outside .next/static directory', async () => {
      const pathsToCheck = [
        `/_next/static/../server/pages-manifest.json`,
        `/_next/static/../server/build-manifest.json`,
        `/_next/static/../BUILD_ID`,
        `/_next/static/../routes-manifest.json`,
      ]
      for (const path of pathsToCheck) {
        const res = await fetchViaHTTP(context.appPort, path)
        const text = await res.text()
        try {
          expect(res.status).toBe(404)
          expect(text).toMatch(/This page could not be found/)
        } catch (err) {
          throw new Error(`Path ${path} accessible from the browser`)
        }
      }
    })

    it('should not throw a server error for non-existent traversing paths', async () => {
      const pathsToCheck = [
        `/_next/static/../../server.php`,
        `/public/plugins/../../server.php`,
        `/example-page/../../../does-not-exist`,
        `/public/../../../../../../conf/defaults.ini`,
      ]
      for (const path of pathsToCheck) {
        const res = await fetchViaHTTP(context.appPort, path)
        try {
          expect([400, 404].includes(res.status)).toBeTruthy()
        } catch (err) {
          throw new Error(
            `Path ${path} had the status of ${res.status} instead of 400`
          )
        }
      }
    })

    it("should not leak the user's home directory into the build", async () => {
      const buildId = readFileSync(join(__dirname, '../.next/BUILD_ID'), 'utf8')

      const readPath = join(__dirname, `../.next/static/${buildId}`)
      const buildFiles = await recursiveReadDir(readPath, (f) =>
        /\.js$/.test(f)
      )

      if (buildFiles.length < 1) {
        throw new Error('Could not locate any build files')
      }

      const homeDir = homedir()
      buildFiles.forEach((buildFile) => {
        const content = readFileSync(join(readPath, buildFile), 'utf8')
        if (content.includes(homeDir)) {
          throw new Error(
            `Found the user's home directory in: ${buildFile}, ${homeDir}\n\n${content}`
          )
        }
        // TODO: this checks the monorepo's path currently, we should check
        // the Next.js apps directory instead once using isolated next
        const checkPathProject = join(__dirname, ...Array(4).fill('..'))
        if (
          content.includes(checkPathProject) ||
          (process.platform.match(/win/) &&
            content.includes(checkPathProject.replace(/\\/g, '\\\\')))
        ) {
          throw new Error(
            `Found the project path in: ${buildFile}, ${checkPathProject}\n\n${content}`
          )
        }
      })
    })

    it('should prevent URI based XSS attacks', async () => {
      const browser = await webdriver(
        context.appPort,
        '/\',document.body.innerHTML="INJECTED",\''
      )
      await checkInjected(browser)
      await browser.close()
    })

    it('should prevent URI based XSS attacks using single quotes', async () => {
      const browser = await webdriver(
        context.appPort,
        `/'-(document.body.innerHTML='INJECTED')-'`
      )
      await checkInjected(browser)
      await browser.close()
    })

    it('should prevent URI based XSS attacks using double quotes', async () => {
      const browser = await webdriver(
        context.appPort,
        `/"-(document.body.innerHTML='INJECTED')-"`
      )
      await checkInjected(browser)

      await browser.close()
    })

    it('should prevent URI based XSS attacks using semicolons and double quotes', async () => {
      const browser = await webdriver(
        context.appPort,
        `/;"-(document.body.innerHTML='INJECTED')-"`
      )
      await checkInjected(browser)

      await browser.close()
    })

    it('should prevent URI based XSS attacks using semicolons and single quotes', async () => {
      const browser = await webdriver(
        context.appPort,
        `/;'-(document.body.innerHTML='INJECTED')-'`
      )
      await checkInjected(browser)

      await browser.close()
    })

    it('should prevent URI based XSS attacks using src', async () => {
      const browser = await webdriver(
        context.appPort,
        `/javascript:(document.body.innerHTML='INJECTED')`
      )
      await checkInjected(browser)

      await browser.close()
    })

    it('should prevent URI based XSS attacks using querystring', async () => {
      const browser = await webdriver(
        context.appPort,
        `/?javascript=(document.body.innerHTML='INJECTED')`
      )
      await checkInjected(browser)

      await browser.close()
    })

    it('should prevent URI based XSS attacks using querystring and quotes', async () => {
      const browser = await webdriver(
        context.appPort,
        `/?javascript="(document.body.innerHTML='INJECTED')"`
      )
      await checkInjected(browser)
      await browser.close()
    })

    it('should handle encoded value in the pathname correctly \\', async () => {
      const res = await fetchViaHTTP(
        context.appPort,
        '/redirect/me/to-about/' + encodeURI('\\google.com'),
        undefined,
        {
          redirect: 'manual',
        }
      )

      const { pathname, hostname } = url.parse(
        res.headers.get('location') || ''
      )
      expect(res.status).toBe(307)
      expect(pathname).toBe(encodeURI('/\\google.com/about'))
      expect(hostname).toBeOneOf(['localhost', '127.0.0.1'])
    })

    it('should handle encoded value in the pathname correctly %', async () => {
      const res = await fetchViaHTTP(
        context.appPort,
        '/redirect/me/to-about/%25google.com',
        undefined,
        {
          redirect: 'manual',
        }
      )

      const { pathname, hostname } = url.parse(
        res.headers.get('location') || ''
      )
      expect(res.status).toBe(307)
      expect(pathname).toBe('/%25google.com/about')
      expect(hostname).toBeOneOf(['localhost', '127.0.0.1'])
    })

    it('should handle encoded value in the query correctly', async () => {
      const res = await fetchViaHTTP(
        context.appPort,
        '/trailing-redirect/?url=https%3A%2F%2Fgoogle.com%2Fimage%3Fcrop%3Dfocalpoint%26w%3D24&w=1200&q=100',
        undefined,
        {
          redirect: 'manual',
        }
      )

      const { pathname, hostname, query } = url.parse(
        res.headers.get('location') || ''
      )
      expect(res.status).toBe(308)
      expect(pathname).toBe('/trailing-redirect')
      expect(hostname).toBeOneOf(['localhost', '127.0.0.1'])
      expect(query).toBe(
        'url=https%3A%2F%2Fgoogle.com%2Fimage%3Fcrop%3Dfocalpoint%26w%3D24&w=1200&q=100'
      )
    })

    it('should handle encoded value in the pathname correctly /', async () => {
      const res = await fetchViaHTTP(
        context.appPort,
        '/redirect/me/to-about/%2fgoogle.com',
        undefined,
        {
          redirect: 'manual',
        }
      )

      const { pathname, hostname } = url.parse(
        res.headers.get('location') || ''
      )
      expect(res.status).toBe(307)
      expect(pathname).toBe('/%2fgoogle.com/about')
      expect(hostname).not.toBe('google.com')
    })

    it('should handle encoded value in the pathname to query correctly (/)', async () => {
      const res = await fetchViaHTTP(
        context.appPort,
        '/redirect-query-test/%2Fgoogle.com',
        undefined,
        {
          redirect: 'manual',
        }
      )

      const { pathname, hostname, query } = url.parse(
        res.headers.get('location') || ''
      )
      expect(res.status).toBe(307)
      expect(pathname).toBe('/about')
      expect(query).toBe('foo=%2Fgoogle.com')
      expect(hostname).not.toBe('google.com')
      expect(hostname).not.toMatch(/google/)
    })

    it('should handle encoded / value for trailing slash correctly', async () => {
      const res = await fetchViaHTTP(
        context.appPort,
        '/%2fexample.com/',
        undefined,
        { redirect: 'manual' }
      )

      const { pathname, hostname } = url.parse(
        res.headers.get('location') || ''
      )
      expect(res.status).toBe(308)
      expect(pathname).toBe('/%2fexample.com')
      expect(hostname).not.toBe('example.com')
    })

    if (browserName !== 'internet explorer') {
      it('should not execute script embedded inside svg image, even if dangerouslyAllowSVG=true', async () => {
        let browser
        try {
          browser = await webdriver(context.appPort, '/svg-image')
          await browser.eval(`document.getElementById("img").scrollIntoView()`)
          const src = await browser.elementById('img').getAttribute('src')
          expect(src).toMatch(/_next\/image\?.*xss\.svg/)
          expect(await browser.elementById('msg').text()).toBe('safe')
          browser = await webdriver(
            context.appPort,
            '/_next/image?url=%2Fxss.svg&w=256&q=75'
          )
          expect(await browser.elementById('msg').text()).toBe('safe')
        } finally {
          if (browser) await browser.close()
        }
      })
    }
  })
}
