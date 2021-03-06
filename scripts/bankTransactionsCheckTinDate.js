const keyBy = require('lodash/keyBy')
const tz = require('timezone')
const eu = tz(require('timezone/Europe'))
const jdiff = require('jest-diff')
const mkAPI = require('./api')

const DOCTYPE_BANK_TRANSACTIONS = 'io.cozy.bank.operations'
const DOCTYPE_BANK_ACCOUNTS = 'io.cozy.bank.accounts'
const DOCTYPE_BANK_SETTINGS = 'io.cozy.bank.settings'

let client, api, log

const diff = (current, updated) => {
    return jdiff(current, updated)
        .replace('Received', 'Updated')
        .replace('Expected', 'Current')
}

const logWithInstance = function () {
  const args = [].slice.call(arguments)
  args.splice(0, 0, client._url.replace('https://', ''))
  console.log.apply(console, args)
}

const parisTime = date => {
  if (!date) { return }
  const epoch = tz(date)
  return eu(epoch, 'Europe/Paris', '%FT%T%^z')
}

const removeSpaceFromDates = transaction => {
  const utransaction = {...transaction}
  utransaction.date = utransaction.date.replace(' ', 'T')
  if (transaction.dateOperation) {
    utransaction.dateOperation = utransaction.dateOperation.replace(' ', 'T')
  }
  return utransaction
}

const migrateTransactionsV1 = docs => docs.map(migrateTransactionV1)

const doMigrations = async dryRun => {
  const index = await client.data.defineIndex("io.cozy.bank.operations", ["date"])
  const transactions = (await api.fetchAll('io.cozy.bank.operations')).filter(x => x.date.indexOf(' ') > -1)

  const utransactions = transactions.map(removeSpaceFromDates)

   if (!dryRun) {
    await api.updateAll(DOCTYPE_BANK_TRANSACTIONS, utransactions)
  } else {
    logWithInstance('Dry run: first updated transaction', diff(transactions[0], utransactions[0]))
  }

  logWithInstance(dryRun ? 'Would update' : 'Has updated', transactions.length, DOCTYPE_BANK_TRANSACTIONS)
}

module.exports = {
  api: api,
  getDoctypes: function () {
    return [
      DOCTYPE_BANK_TRANSACTIONS,
    ]
  },

  run: async function (ach, dryRun=true) {
    client = ach.client
    api = mkAPI(client)
    try {
      await doMigrations(dryRun)
    } catch (err) {
      console.log(ach.url, err)
    }
  }
}
