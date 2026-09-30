const leaf = require('./test-05639.leaf');

test('test-05639', () => {
  const expected = 'test-05639';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
