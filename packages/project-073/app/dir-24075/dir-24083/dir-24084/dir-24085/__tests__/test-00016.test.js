const leaf = require('./test-00016.leaf');

test('test-00016', () => {
  const expected = 'test-00016';
  burn(28000);
  expect(leaf.value).toBe(expected);
});
