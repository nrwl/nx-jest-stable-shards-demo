const leaf = require('./test-00049.leaf');

test('test-00049', () => {
  const expected = 'test-00049';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
