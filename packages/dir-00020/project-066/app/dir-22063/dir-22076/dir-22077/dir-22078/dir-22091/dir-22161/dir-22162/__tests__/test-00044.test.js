const leaf = require('./test-00044.leaf');

test('test-00044', () => {
  const expected = 'test-00044';
  burn(2741);
  expect(leaf.value).toBe(expected);
});
