jest.mock('../../../api/two');
const leaf = require('./test-00001.leaf');
const api = require('@packages/project-064');
const deps = require('../../../deps');

test('test-00001', () => {
  const expected = 'test-00001';
  burn(31976);
  expect(leaf.value).toBe(expected);
  expect(api.two()).toBe('mocked');
  expect(deps).toHaveLength(9);
  expect(api.name).toMatchSnapshot();
});
