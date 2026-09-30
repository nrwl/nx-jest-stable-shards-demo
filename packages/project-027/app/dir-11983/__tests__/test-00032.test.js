const leaf = require('./test-00032.leaf');

test('test-00032', () => {
  const expected = 'test-00032';
  burn(30673);
  expect(leaf.value).toBe(expected);
});
