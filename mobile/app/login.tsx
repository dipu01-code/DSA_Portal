import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Link, Redirect } from 'expo-router';
import { useAuth } from '@dsa-portal/ui-core';
import { Body, Button, Card, ErrorText, Field, H1 } from '../src/components/ui';
import { useTheme } from '../src/theme';

export default function Login() {
  const { status, login, busy, error } = useAuth();
  const { c, space } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  if (status === 'authenticated') return <Redirect href="/" />;
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: space.xl,
          maxWidth: 480,
          width: '100%',
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <H1>Sign in</H1>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void login(email.trim(), password)}
          />
          {error && <ErrorText>{error}</ErrorText>}
          <Button
            title="Sign in"
            primary
            busy={busy}
            onPress={() => void login(email.trim(), password)}
          />
          <Body muted>
            {'\n'}New here?{' '}
            <Link href="/register" style={{ color: c.primary }}>
              Create an account
            </Link>
          </Body>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
