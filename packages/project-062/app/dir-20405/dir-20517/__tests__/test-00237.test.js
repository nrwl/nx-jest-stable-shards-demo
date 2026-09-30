const leaf = require('./test-00237.leaf');

test('test-00237', () => {
  const expected = 'test-00237';
  burn(10613);
  expect(leaf.value).toBe(expected);
});
