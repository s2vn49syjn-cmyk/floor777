import {main} from './publish-workflow/cli.mjs';
main('stage').catch(error => {console.error(error.message); process.exitCode = 1;});
