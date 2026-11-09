import { readFileSync } from 'fs';
import { join } from 'path';
import { SAMSUNG_SETUP_STEPS } from '../samsungSetup';

describe('samsung setup guide', () => {
  it('has the same steps in the doc and in the app', () => {
    const doc = readFileSync(join(__dirname, '../../../docs/samsung-setup.md'), 'utf8');
    const docSteps = doc
      .split('\n')
      .filter((line) => /^\d+\. /.test(line))
      .map((line) => line.replace(/^\d+\. /, '').replace(/\*\*/g, ''));
    expect(docSteps).toEqual(SAMSUNG_SETUP_STEPS);
  });
});
