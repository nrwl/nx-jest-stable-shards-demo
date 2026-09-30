const leaf = require('./test-04867.leaf');

test('test-04867', () => {
  const expected = 'test-04867';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
