// Fragmento de referencia (no se ejecuta). Spring Security 7 como resource server.
package demo;

import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

  private static final String ISSUER = "http://127.0.0.1:18600/realms/demo";
  private static final String AUDIENCE = "orders-api";

  @Bean
  SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
      // Todo exige un token válido; el algoritmo y la firma los fija el validador del JWKS (RS256).
      .authorizeHttpRequests(a -> a.anyRequest().authenticated())
      .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt.decoder(jwtDecoder())));
    return http.build();
  }

  @Bean
  JwtDecoder jwtDecoder() {
    // fromIssuerLocation valida firma (JWKS), iss y exp. Por defecto NO valida aud:
    NimbusJwtDecoder decoder = JwtDecoders.fromIssuerLocation(ISSUER);
    OAuth2TokenValidator<Jwt> withIssuer = JwtValidators.createDefaultWithIssuer(ISSUER);
    // CORRECCIÓN: añadir la comprobación de audiencia (equivale a audience:'orders-api' de jose).
    OAuth2TokenValidator<Jwt> withAudience = jwt ->
        jwt.getAudience().contains(AUDIENCE)
            ? OAuth2TokenValidatorResult.success()
            : OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", "falta aud=" + AUDIENCE, null));
    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(List.of(withIssuer, withAudience)));
    return decoder;
  }
}
