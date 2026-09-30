const leaf = require('./test-04570.leaf');

test('test-04570', () => {
  const expected = 'test-04570';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
