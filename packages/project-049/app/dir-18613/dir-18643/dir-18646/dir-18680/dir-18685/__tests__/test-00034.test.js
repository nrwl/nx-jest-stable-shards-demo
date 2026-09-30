const leaf = require('./test-00034.leaf');

test('test-00034', () => {
  const expected = 'test-00034';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
