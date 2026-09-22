'use strict';

const config = require('../config');

let client = null;
if (config.stripe.secretKey) {
  const Stripe = require('stripe');
  client = new Stripe(config.stripe.secretKey);
}

module.exports = { client };
