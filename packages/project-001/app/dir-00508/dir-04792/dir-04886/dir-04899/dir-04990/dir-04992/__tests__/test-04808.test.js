const leaf = require('./test-04808.leaf');

test('test-04808', () => {
  const expected = 'test-04808';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
