const leaf = require('./test-00004.leaf');

test('test-00004', () => {
  const expected = 'test-00004';
  burn(27498);
  expect(leaf.value).toBe(expected);
});
