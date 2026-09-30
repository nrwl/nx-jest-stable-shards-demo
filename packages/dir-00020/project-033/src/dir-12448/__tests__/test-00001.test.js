jest.mock('../../../api/two');
const leaf = require('./test-00001.leaf');
const api = require('@packages/dir-00020/project-033');
const deps = require('../../../deps');

test('test-00001', () => {
  const expected = 'test-00001';
  burn(29481);
  expect(leaf.value).toBe(expected);
  expect(api.two()).toBe('mocked');
  expect(deps).toHaveLength(6);
  expect(api.name).toMatchSnapshot();
});
