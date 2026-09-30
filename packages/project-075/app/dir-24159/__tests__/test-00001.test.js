jest.mock('../../../api/two');
const leaf = require('./test-00001.leaf');
const api = require('@packages/project-075');
const deps = require('../../../deps');

test('test-00001', () => {
  const expected = 'test-00001';
  burn(26535);
  expect(leaf.value).toBe(expected);
  expect(api.two()).toBe('mocked');
  expect(deps).toHaveLength(3);
  expect(api.name).toMatchSnapshot();
});
