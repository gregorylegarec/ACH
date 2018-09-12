#!/usr/bin/env node

const fs = require('fs')
const appPackage = require('./package.json')
const path = require('path')
const { keyBy, sortBy } = require('lodash')
const spawnSync = require('child_process').spawnSync

const { ACH, importData, assert, log, askConfirmation } = require('./libs')

const DEFAULT_COZY_URL = 'http://cozy.tools:8080'

// Add promise rejection handling
process.on('unhandledRejection', function(err) {
  log.error('Unhandled promise rejection.\n' + err.stack)
})

// the CLI interface
let program = require('commander')
program
  .version(appPackage.version)
  .option('-t --token [token]', 'Token file to use')
  .option('-y --yes', 'Does not ask for confirmation on sensitive operations')
  .option(
    '-u --url [url]',
    `URL of the cozy to use. Defaults to "${DEFAULT_COZY_URL}".'`,
    DEFAULT_COZY_URL
  )

function fileExists(p) {
  if (p && !fs.existsSync(path.resolve(p))) {
    return false
  } else {
    return true
  }
}

program
  .command('import <filepath> [handlebarsOptionsFile]')
  .description(
    'The file containing the JSON data to import. Defaults to "example-data.json". Then the dummy helpers JS file (optional).'
  )
  .action((filepath, handlebarsOptionsFile) => {
    assert(fileExists(filepath), `${filepath} does not exist`)
    assert(
      fileExists(handlebarsOptionsFile),
      `${handlebarsOptionsFile} does not exist`
    )
    const { url, token } = program
    return importData(url, token, filepath, handlebarsOptionsFile)
  })

program
  .command('importDir <directoryPath>')
  .description(
    'The path to the directory content to import. Defaults to "./DirectoriesToInject".'
  )
  .action(directoryPath => {
    if (!directoryPath) directoryPath = './DirectoriesToInject'

    // get directories tree in JSON format
    const dirTree = require('directory-tree')
    const JSONtree = dirTree(directoryPath, {})

    const { url, token } = program
    const ach = new ACH(token, url, ['io.cozy.files'])
    ach.connect().then(() => {
      return ach.importFolder(JSONtree)
    })
  })

program
  .command('generateFiles [path] [filesCount]')
  .description('Generates a given number of small files.')
  .action((path = '/', filesCount = 10) => {
    const { url, token } = program
    const ach = new ACH(token, url, ['io.cozy.files'])
    ach.connect().then(() => {
      return ach.createFiles(path, parseInt(filesCount))
    })
  })

program
  .command('drop <doctypes...>')
  .description('Deletes all documents of the provided doctypes. For real.')
  .action(doctypes => {
    const question = `This doctypes will be removed.

${doctypes.map(x => `* ${x}`).join(' \n')}

Type "yes" if ok.
`
    const confirm = program.yes
      ? function(question, cb) {
          cb()
        }
      : askConfirmation
    confirm(
      question,
      () => {
        // get the url of the cozy
        const { url, token } = program
        const ach = new ACH(token, url, doctypes)
        ach.connect().then(() => {
          return ach.dropCollections(doctypes)
        })
      },
      () => {
        console.log('Cancelled drop')
      }
    )
  })

const isCommandAvailable = command => {
  try {
    const spawned = spawnSync('which', [command], {
      stdio: 'pipe'
    })
    return spawned.stdout.length > 0
  } catch (err) {
    return false
  }
}

const makeToken = (url, doctypes) => {
  const args = [url.replace(/https?:\/\//, ''), ...doctypes]
  const spawned = spawnSync('make-token', args, {
    stdio: 'pipe',
    encoding: 'utf-8'
  })
  let token = null
  if (spawned.stdout) {
    token = spawned.stdout.split('\n')[0]
  }
  if (token) {
    log.info('Made token automatically: ' + token)
  } else {
    log.info('Could not automatically create token')
    log.debug(spawned.stderr)
  }
  return token
}

const autotoken = (url, doctypes) => {
  if (isCommandAvailable('make-token') && url.indexOf('cozy.tools') === -1) {
    return makeToken(url, doctypes)
  }
}

program
  .command('export <doctypes> <filename>')
  .description(
    'Exports data from the doctypes (separated by commas) to filename'
  )
  .action((doctypes, filename) => {
    doctypes = doctypes.split(',')
    const url = program.url
    const token = program.token || autotoken(url, doctypes)
    const ach = new ACH(token, url, doctypes)
    ach.connect().then(() => {
      return ach.export(doctypes, filename)
    })
  })

program
  .command('downloadFile <fileid>')
  .description('Download the file')
  .action(fileid => {
    const doctypes = ['io.cozy.files']
    const url = program.url
    const token = program.token || autotoken(url, doctypes)
    const ach = new ACH(token, url, doctypes)
    ach.connect().then(() => {
      return ach.downloadFile(fileid)
    })
  })

program
  .command('delete <doctype> <ids...>')
  .description('Delete document(s)')
  .action((doctype, ids) => {
    const { url, token } = program
    const ach = new ACH(token, url, [doctype])
    ach.connect().then(() => {
      return ach.deleteDocuments(doctype, ids)
    })
  })

program
  .command('updateSettings')
  .description('Update settings')
  .action(settings => {
    const { url, token } = program
    settings = JSON.parse(settings)
    const ach = new ACH(token, url, ['io.cozy.settings'])
    ach.connect().then(() => {
      return ach.updateSettings(settings)
    })
  })

program
  .command('script <scriptName> -- <script options>')
  .option('-x, --execute', 'Execute the script (disable dry run)')
  .option('-d, --doctypes', 'Print necessary doctypes (useful for automation)')
  .description('Launch script')
  .action(function(scriptName, action) {
    const dir = path.join(__dirname, 'scripts')
    let script
    try {
      script = require(path.join(dir, scriptName))
    } catch (e) {
      console.log(e)
      console.error(`${scriptName} does not exist in ${dir}`)
      process.exit(1)
    }
    const { url } = program
    const { getDoctypes, run } = script
    const doctypes = getDoctypes()
    if (action.doctypes) {
      console.log(doctypes.join(' '))
    } else {
      const token = program.token || autotoken(url, doctypes)
      const ach = new ACH(token, url, doctypes)
      const dryRun = process.argv.findIndex(arg => arg === '-x') === -1
      log.info(`Launching script ${scriptName}...`)
      log.info(`Dry run : ${dryRun}`)
      ach.connect().then(() => {
        const dashIndex = process.argv.findIndex(v => v === '--')
        const scritptArgs = process.argv.slice(dashIndex + 1)
        return run(ach, dryRun, scritptArgs)
      })
    }
  })

program
  .command('ls-scripts')
  .description('Lists all scripts, useful for autocompletion')
  .action(function(scriptName, action) {
    const dir = path.join(__dirname, 'scripts')
    const scripts = fs
      .readdirSync(dir)
      .filter(x => /\.js$/.exec(x))
      .filter(x => !/\.spec\.js$/.exec(x))
      .map(x => x.replace(/\.js$/, ''))
    console.log(scripts.join('\n'))
  })

program.parse(process.argv)

const findCommand = program => {
  const lastArg = program.args[program.args.length - 1]
  if (lastArg instanceof program.Command) {
    return lastArg._name
  } else {
    return program.args[0]
  }
}
