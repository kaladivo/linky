import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
const m = generateMnemonic(wordlist, 128);
console.log(m);
console.log(m.split(' ').length);
