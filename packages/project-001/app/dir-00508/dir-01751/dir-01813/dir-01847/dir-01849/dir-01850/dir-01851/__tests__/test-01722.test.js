const leaf = require('./test-01722.leaf');

test('test-01722', () => {
  const expected = 'test-01722';
  burn(1863);
  expect(leaf.value).toBe(expected);
});
