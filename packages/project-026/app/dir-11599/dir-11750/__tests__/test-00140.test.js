const leaf = require('./test-00140.leaf');

test('test-00140', () => {
  const expected = 'test-00140';
  burn(25149);
  expect(leaf.value).toBe(expected);
});
