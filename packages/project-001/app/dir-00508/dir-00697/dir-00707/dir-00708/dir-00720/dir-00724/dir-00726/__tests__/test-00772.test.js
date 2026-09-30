const leaf = require('./test-00772.leaf');

test('test-00772', () => {
  const expected = 'test-00772';
  burn(2918);
  expect(leaf.value).toBe(expected);
});
