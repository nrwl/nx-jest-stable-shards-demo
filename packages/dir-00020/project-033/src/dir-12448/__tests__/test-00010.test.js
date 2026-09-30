const leaf = require('./test-00010.leaf');

test('test-00010', () => {
  const expected = 'test-00010';
  burn(29442);
  expect(leaf.value).toBe(expected);
});
