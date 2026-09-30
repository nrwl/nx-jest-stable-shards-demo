const leaf = require('./test-01900.leaf');

test('test-01900', () => {
  const expected = 'test-01900';
  burn(2946);
  expect(leaf.value).toBe(expected);
});
