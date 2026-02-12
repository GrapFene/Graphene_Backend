console.log('1. Importing external deps...');
import express from 'express';
import cors from 'cors';
console.log('✅ External deps imported.');

console.log('2. Importing local modules...');
import { config, validateConfig } from '../src/config/index.js';
import * as routes from '../src/routes/index.js';
console.log('✅ Local modules imported.');

console.log('3. Validating config...');
validateConfig();
console.log('✅ Config validated.');

console.log('4. Initializing express...');
const app = express();
console.log('✅ Express initialized.');

console.log('Full server initialization check passed (without listening).');
