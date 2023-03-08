#!/usr/bin/env node
import crypto from 'crypto';
console.log(crypto.randomBytes(16).toString('hex'));
