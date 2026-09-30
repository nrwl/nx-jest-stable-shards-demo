const leaf = require('./test-00357.leaf');

test('test-00357', () => {
  const expected = 'test-00357';
  burn(2620);
  expect(leaf.value).toBe(expected);
});
