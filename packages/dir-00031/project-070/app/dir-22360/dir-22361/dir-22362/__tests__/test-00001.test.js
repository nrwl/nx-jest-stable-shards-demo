jest.mock('../../../../../api/two');
const leaf = require('./test-00001.leaf');
const api = require('@packages/dir-00031/project-070');
const deps = require('../../../../../deps');

test('test-00001', () => {
  const expected = 'test-00001';
  burn(24003);
  expect(leaf.value).toBe(expected);
  expect(api.two()).toBe('mocked');
  expect(deps).toHaveLength(9);
  expect(api.name).toMatchSnapshot();
});
