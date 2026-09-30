const leaf = require('./test-03324.leaf');

test('test-03324', () => {
  const expected = 'test-03324';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
