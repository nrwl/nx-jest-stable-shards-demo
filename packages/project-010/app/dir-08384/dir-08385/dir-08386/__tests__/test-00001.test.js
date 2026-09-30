jest.mock('../../../../../api/two');
const leaf = require('./test-00001.leaf');
const api = require('@packages/project-010');
const deps = require('../../../../../deps');

test('test-00001', () => {
  const expected = 'test-00001';
  burn(95887);
  expect(leaf.value).toBe(expected);
  expect(api.two()).toBe('mocked');
  expect(deps).toHaveLength(6);
  expect(api.name).toMatchSnapshot();
});
