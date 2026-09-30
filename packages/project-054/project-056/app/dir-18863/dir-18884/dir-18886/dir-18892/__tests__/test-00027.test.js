const leaf = require('./test-00027.leaf');

test('test-00027', () => {
  const expected = 'test-00027';
  burn(33638);
  expect(leaf.value).toBe(expected);
});
