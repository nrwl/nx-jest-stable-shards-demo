const leaf = require('./test-00038.leaf');

test('test-00038', () => {
  const expected = 'test-00038';
  burn(3227);
  expect(leaf.value).toBe(expected);
});
